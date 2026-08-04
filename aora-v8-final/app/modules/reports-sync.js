"use strict";

(function installSynchronizedReports(){
  const defaultRange=()=>{
    const today=String(typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10));
    return{from:`${today.slice(0,7)}-01`,to:today,employeeId:"all"};
  };
  const filtersState=()=>S.reportFilters||(S.reportFilters=defaultRange());
  const inRange=(date,from,to)=>Boolean(date)&&date>=from&&date<=to;
  const entryDate=item=>String(item?.date||item?.startTime||item?.start_time||"").slice(0,10);
  const entryStart=item=>String(item?.start||item?.startTime||item?.start_time||"").includes("T")?String(item?.start||item?.startTime||item?.start_time||"").slice(11,16):String(item?.start||"").slice(0,5);
  const entryEnd=item=>String(item?.end||item?.endTime||item?.end_time||"").includes("T")?String(item?.end||item?.endTime||item?.end_time||"").slice(11,16):String(item?.end||"").slice(0,5);
  const entryBreak=item=>Math.max(0,Number(item?.breakMinutes??item?.break_minutes??0)||0);
  const text=value=>String(value??"").replace(/\s+/g," ").trim();
  const timeMinutes=value=>{const match=String(value||"").match(/^(\d{1,2}):(\d{2})/);return match?Number(match[1])*60+Number(match[2]):0};
  const duration=item=>{
    const start=entryStart(item),endValue=entryEnd(item);
    if(!start||!endValue)return 0;
    const startMinutes=timeMinutes(start);let endMinutes=timeMinutes(endValue);if(endMinutes<startMinutes)endMinutes+=1440;
    return Math.max(0,endMinutes-startMinutes-entryBreak(item));
  };
  const formatMinutes=(value,{signed=false}={})=>{
    const minutes=Math.round(Number(value)||0),sign=minutes<0?"−":signed&&minutes>0?"+":"",absolute=Math.abs(minutes);
    return`${sign}${String(Math.floor(absolute/60)).padStart(2,"0")}:${String(absolute%60).padStart(2,"0")}`;
  };
  const dateObject=date=>new Date(`${date}T12:00:00Z`);
  const displayDate=date=>new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(dateObject(date));
  const weekday=date=>new Intl.DateTimeFormat("de-DE",{weekday:"short",timeZone:"UTC"}).format(dateObject(date)).replace(".","");
  const rangeLabel=(from,to)=>`${displayDate(from)} – ${displayDate(to)}`;
  const enumerateDates=(from,to)=>{
    const dates=[],cursor=dateObject(from),end=dateObject(to);let guard=0;
    while(cursor<=end&&guard<370){dates.push(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()+1);guard+=1}
    return dates;
  };
  const leaveRange=item=>{
    const start=[item?.startDate,item?.start,item?.from,item?.startsOn,item?.dateFrom,item?.date].find(Boolean);
    const end=[item?.endDate,item?.end,item?.to,item?.endsOn,item?.dateTo,start].find(Boolean);
    return{start:String(start||""),end:String(end||start||"")};
  };
  const leaveType=item=>{
    const kind=String(item?.type||item?.kind||item?.reason||"").toLowerCase();
    if(/urlaub|vacation|holiday/.test(kind))return"Urlaub";
    if(/krank|sick|ill/.test(kind))return"Krankheit";
    return"Abwesenheit";
  };
  const reportEmployees=ownerMode=>(S.state?.employees||[])
    .filter(employee=>employee.active!==false&&employee.status!=="pending"&&employee.status!=="revoked")
    .filter(employee=>ownerMode||String(employee.locationId||employee.primaryLocationId||"")===String(S.locationId||""))
    .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"de"));
  const aggregateEntries=items=>{
    const entries=items.slice().sort((a,b)=>entryStart(a).localeCompare(entryStart(b)));
    const open=entries.filter(item=>!entryEnd(item)||["live","paused"].includes(String(item.status||"")));
    const closed=entries.filter(item=>entryEnd(item)&&!["live","paused"].includes(String(item.status||"")));
    const notes=entries.map(item=>text(item.note||item.comment||"")).filter(Boolean);
    if(entries.length>1)notes.unshift(`${entries.length} Buchungen`);
    if(open.length)notes.push("Clock-out fehlt");
    return{
      type:open.length?"Offen":"Arbeit",
      start:entries.map(item=>entryStart(item)||"–").join(" / "),
      end:entries.map(item=>entryEnd(item)||"läuft").join(" / "),
      breakMinutes:closed.reduce((sum,item)=>sum+entryBreak(item),0),
      netMinutes:closed.reduce((sum,item)=>sum+duration(item),0),
      note:[...new Set(notes)].join(" · "),
      entryCount:entries.length,
      openCount:open.length
    };
  };
  const overlap=(start,end,rangeStart,rangeEnd)=>Math.max(0,Math.min(end,rangeEnd)-Math.max(start,rangeStart));
  const nightMinutes=item=>{
    const startValue=entryStart(item),endValue=entryEnd(item);if(!startValue||!endValue)return 0;
    let start=timeMinutes(startValue),end=timeMinutes(endValue);if(end<start)end+=1440;
    const gross=overlap(start,end,0,360)+overlap(start,end,1200,1440)+overlap(start,end,1440,1800);
    return Math.min(duration(item),gross);
  };

  function reportData(employee,from,to){
    const employeeId=String(employee.id);
    const shifts=(S.state?.shifts||[]).filter(item=>String(item.employeeId??item.employee_id)===employeeId&&inRange(String(item.date||""),from,to));
    const entries=(S.state?.timeEntries||[]).filter(item=>String(item.employeeId??item.employee_id)===employeeId&&inRange(entryDate(item),from,to));
    const leaves=(S.state?.leaveRequests||[]).filter(item=>{
      if(String(item.employeeId??item.employee_id)!==employeeId||String(item.status||"").toLowerCase()==="rejected")return false;
      const range=leaveRange(item);return range.start<=to&&range.end>=from;
    });
    const dailyTarget=Math.round((Number(employee.weeklyHours||employee.contractHours||employee.weeklyTargetHours||40)*60)/5);
    const rows=enumerateDates(from,to).map(date=>{
      const dateEntries=entries.filter(item=>entryDate(item)===date);
      const dateShifts=shifts.filter(item=>String(item.date)===date).sort((a,b)=>String(a.start||"").localeCompare(String(b.start||"")));
      const leave=leaves.find(item=>{const range=leaveRange(item);return range.start<=date&&range.end>=date});
      let row={date,day:weekday(date),type:"–",start:"–",end:"–",breakMinutes:0,netMinutes:0,note:"",entryCount:0,openCount:0};
      if(leave){row={...row,type:leaveType(leave),start:"–",end:"–",netMinutes:dailyTarget,note:text(leave.note||leave.reason||"Genehmigte Abwesenheit")}}
      else if(dateEntries.length){row={...row,...aggregateEntries(dateEntries)}}
      else if(dateShifts.length){row={...row,type:"Fehlzeit",start:dateShifts.map(item=>text(item.start)||"–").join(" / "),end:dateShifts.map(item=>text(item.end)||"–").join(" / "),breakMinutes:dateShifts.reduce((sum,item)=>sum+Math.max(0,Number(item.breakMinutes)||0),0),note:dateShifts.length>1?`Keine Zeitbuchung · ${dateShifts.length} geplante Schichten`:"Keine Zeitbuchung"}}
      else if([0,6].includes(dateObject(date).getUTCDay()))row.type="Wochenende";
      return row;
    }).filter(row=>row.type!=="–"||![0,6].includes(dateObject(row.date).getUTCDay()));
    const worked=rows.reduce((sum,row)=>sum+(["Arbeit","Offen"].includes(row.type)?row.netMinutes:0),0);
    const credited=rows.reduce((sum,row)=>sum+(["Urlaub","Krankheit","Abwesenheit"].includes(row.type)?row.netMinutes:0),0);
    const planned=shifts.reduce((sum,item)=>sum+duration(item),0);
    const displayedWorkDates=new Set(rows.filter(row=>["Arbeit","Offen"].includes(row.type)).map(row=>row.date));
    const closed=entries.filter(item=>displayedWorkDates.has(entryDate(item))&&entryEnd(item)&&!["live","paused"].includes(String(item.status||"")));
    const openEntries=entries.filter(item=>!entryEnd(item)||["live","paused"].includes(String(item.status||""))).length;
    const missingDays=rows.filter(row=>row.type==="Fehlzeit").length;
    const total=worked+credited;
    return{
      employee,rows,planned,worked,credited,total,difference:total-planned,overtime:Math.max(0,total-planned),
      breaks:rows.reduce((sum,row)=>sum+(["Arbeit","Offen"].includes(row.type)?row.breakMinutes:0),0),
      night:closed.reduce((sum,item)=>sum+nightMinutes(item),0),
      sunday:closed.reduce((sum,item)=>sum+(dateObject(entryDate(item)).getUTCDay()===0||item.isHoliday||item.holiday?duration(item):0),0),
      vacation:rows.reduce((sum,row)=>sum+(row.type==="Urlaub"?row.netMinutes:0),0),
      sick:rows.reduce((sum,row)=>sum+(row.type==="Krankheit"?row.netMinutes:0),0),
      workDays:rows.filter(row=>["Arbeit","Offen"].includes(row.type)&&row.netMinutes>0).length,
      entryCount:entries.length,openEntries,missingDays,status:openEntries||missingDays?"Offen":"Vollständig"
    };
  }
  const employeeMeta=employee=>({
    personnel:employee.personnelNumber||employee.employeeNumber||employee.staffNumber||`A-${String(employee.id||"").slice(-5).toUpperCase()}`,
    position:employee.position||employee.jobTitle||employee.role||"Mitarbeiter/in",
    department:employee.department||employee.team||loc(employee.locationId||employee.primaryLocationId)?.name||"Betrieb",
    contract:employee.employmentType||employee.contractType||"Beschäftigt",
    target:`${Number(employee.weeklyHours||employee.contractHours||40)} Std./Woche`
  });
  const metric=(icon,label,value,sub="")=>`<div class="aora-report-metric"><div class="aora-report-metric-icon">${icon}</div><div><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:""}</div></div>`;
  const reportRows=rows=>rows.slice(0,35).map(row=>`<tr class="${["Offen","Fehlzeit"].includes(row.type)?"attention":""}"><td>${esc(displayDate(row.date))}</td><td>${esc(row.day)}</td><td>${esc(row.start)}</td><td>${esc(row.end)}</td><td>${esc(formatMinutes(row.breakMinutes))}</td><td><strong>${esc(formatMinutes(row.netMinutes))}</strong></td><td><span class="aora-report-type ${esc(row.type.toLowerCase())}">${esc(row.type)}</span></td><td>${esc(row.note||"–")}</td></tr>`).join("")+(rows.length>35?`<tr><td colspan="8" class="aora-report-more">+ ${rows.length-35} weitere Tage im gewählten Zeitraum</td></tr>`:"");

  function reportSheet(data,from,to,{printOnly=false}={}){
    const employee=data.employee,meta=employeeMeta(employee),location=loc(employee.locationId||employee.primaryLocationId),company=String(S.state?.company?.name||"Arbeitgeber");
    const statusClass=data.status==="Vollständig"?"confirmed":"open";
    return`<article class="aora-report-sheet ${printOnly?"print-only":""}">
      <header class="aora-report-document-head"><div class="aora-report-brand aora-report-employer"><strong>${esc(company)}</strong><span>${esc(location?.name||"Standort")}</span></div><div class="aora-report-document-title"><span>Live-Arbeitszeitbericht</span><strong>Stundenübersicht</strong></div><div class="aora-report-created"><span>Erstellt am</span><strong>${esc(new Intl.DateTimeFormat("de-DE",{dateStyle:"medium",timeStyle:"short"}).format(new Date()))}</strong></div></header>
      <div class="aora-report-period">${I.cal}<strong>${esc(rangeLabel(from,to))}</strong><span>${esc(location?.name||company)}</span></div>
      <section class="aora-report-person"><div class="aora-report-avatar">${esc(employee.initials||initials(employee.name||"A"))}</div><div class="aora-report-person-main"><h2>${esc(employee.name||"Mitarbeiter/in")}</h2><p>${esc(meta.position)} · ${esc(meta.department)}</p></div><dl><div><dt>Personalnummer</dt><dd>${esc(meta.personnel)}</dd></div><div><dt>Vertrag</dt><dd>${esc(meta.contract)}</dd></div><div><dt>Sollzeit</dt><dd>${esc(meta.target)}</dd></div></dl></section>
      <section class="aora-report-summary"><h3>Zusammenfassung</h3><div class="aora-report-metrics primary">${metric(I.cal,"Geplant",formatMinutes(data.planned),"Dienstplan")}${metric(I.clock,"Arbeitszeit",formatMinutes(data.worked),`${data.entryCount} Buchungen`)}${metric(I.chart,"Gesamt",formatMinutes(data.total),"inkl. bezahlter Abwesenheit")}${metric(I.chart,"Differenz",formatMinutes(data.difference,{signed:true}),data.difference>=0?"Über Soll":"Unter Soll")}</div><div class="aora-report-metrics secondary">${metric(I.clock,"Nachtstunden",formatMinutes(data.night))}${metric(I.cal,"Sonntag/Feiertag",formatMinutes(data.sunday))}${metric(I.umbrella,"Urlaub",formatMinutes(data.vacation))}${metric(I.people,"Krankheit",formatMinutes(data.sick))}${metric(I.clock,"Pausen",formatMinutes(data.breaks))}</div></section>
      <section class="aora-report-daily"><div class="aora-report-section-head"><div><span>Tägliche Übersicht</span><strong>${data.rows.length} Kalendertage · alle Buchungen zusammengeführt</strong></div><div class="aora-report-status ${statusClass}">${data.status==="Vollständig"?I.check:I.clock}${esc(data.status)}</div></div><div class="aora-report-table-wrap"><table class="aora-report-table"><thead><tr><th>Datum</th><th>Tag</th><th>Start</th><th>Ende</th><th>Pause</th><th>Netto</th><th>Typ</th><th>Bemerkung</th></tr></thead><tbody>${reportRows(data.rows)}</tbody><tfoot><tr><td colspan="5">Gesamtsumme</td><td>${esc(formatMinutes(data.total))}</td><td colspan="2">Differenz ${esc(formatMinutes(data.difference,{signed:true}))}</td></tr></tfoot></table></div></section>
      <section class="aora-report-footer-stats"><div><span>Arbeitstage</span><strong>${data.workDays}</strong></div><div><span>Offene Buchungen</span><strong>${data.openEntries}</strong></div><div><span>Unvollständige Tage</span><strong>${data.missingDays}</strong></div></section>
      <footer class="aora-report-signatures"><div><span>Datenstatus</span><strong>Live-Auswertung</strong></div><div><span>Mitarbeiterfreigabe</span><strong>Nicht enthalten</strong></div><div class="aora-report-final-status"><span>Vollständigkeit</span><strong class="${statusClass}">${esc(data.status)}</strong></div></footer>
      <div class="aora-report-page-footer"><span>${esc(company)}</span><span>${esc(location?.name||"Standort")} · offizieller bestätigter Nachweis unter Freigaben</span></div>
    </article>`;
  }
  function allEmployeesSummary(employees,from,to){
    const datasets=employees.map(employee=>reportData(employee,from,to));
    const totals=datasets.reduce((sum,item)=>({planned:sum.planned+item.planned,worked:sum.worked+item.worked,total:sum.total+item.total,difference:sum.difference+item.difference}),{planned:0,worked:0,total:0,difference:0});
    return`<article class="aora-report-overview-card"><div class="aora-report-section-head"><div><span>Live-Übersicht aller Mitarbeiter</span><strong>${esc(rangeLabel(from,to))}</strong></div><div class="aora-report-count">${employees.length} Personen</div></div><div class="aora-report-metrics primary overview-metrics">${metric(I.cal,"Plan",formatMinutes(totals.planned))}${metric(I.clock,"Arbeit",formatMinutes(totals.worked))}${metric(I.chart,"Gesamt",formatMinutes(totals.total))}${metric(I.chart,"Differenz",formatMinutes(totals.difference,{signed:true}))}</div><div class="aora-report-table-wrap"><table class="aora-report-table overview"><thead><tr><th>Mitarbeiter</th><th>Standort</th><th>Soll</th><th>Arbeit</th><th>Gesamt</th><th>Differenz</th><th>Buchungen</th><th>Status</th></tr></thead><tbody>${datasets.map(data=>`<tr><td><strong>${esc(data.employee.name||"–")}</strong></td><td>${esc(loc(data.employee.locationId||data.employee.primaryLocationId)?.name||"–")}</td><td>${esc(formatMinutes(data.planned))}</td><td>${esc(formatMinutes(data.worked))}</td><td>${esc(formatMinutes(data.total))}</td><td class="${data.difference<0?"negative":"positive"}">${esc(formatMinutes(data.difference,{signed:true}))}</td><td>${data.entryCount}</td><td><span class="aora-report-status ${data.status==="Vollständig"?"confirmed":"open"}">${esc(data.status)}</span></td></tr>`).join("")||'<tr><td colspan="8">Keine Mitarbeiter vorhanden.</td></tr>'}</tbody></table></div></article>`;
  }
  const filters=(ownerMode,employees,filters)=>`<section class="aora-report-toolbar panel"><div class="aora-report-filter"><label for="report-employee">Mitarbeiter</label><select class="select" id="report-employee"><option value="all" ${filters.employeeId==="all"?"selected":""}>Alle Mitarbeiter</option>${employees.map(employee=>`<option value="${esc(employee.id)}" ${String(filters.employeeId)===String(employee.id)?"selected":""}>${esc(employee.name)}${ownerMode?` · ${esc(loc(employee.locationId||employee.primaryLocationId)?.name||"")}`:""}</option>`).join("")}</select></div><div class="aora-report-filter"><label for="report-from">Von</label><input class="input" id="report-from" type="date" value="${esc(filters.from)}"></div><div class="aora-report-filter"><label for="report-to">Bis</label><input class="input" id="report-to" type="date" value="${esc(filters.to)}"></div><div class="aora-report-toolbar-actions"><button class="btn outline" data-a="report-print-all">Alle als PDF</button><button class="btn" data-a="report-print">${I.chart} PDF erstellen</button></div></section>`;

  reportsPage=function(ownerMode=false){
    const filtersValue=filtersState(),employees=reportEmployees(ownerMode);
    if(filtersValue.employeeId!=="all"&&!employees.some(employee=>String(employee.id)===String(filtersValue.employeeId)))filtersValue.employeeId="all";
    const selected=employees.find(employee=>String(employee.id)===String(filtersValue.employeeId));
    const intro=`<div class="compliance-alert"><strong>Live-Bericht</strong><span>Diese Ansicht zeigt den aktuellen Stand aus Stempeluhr und genehmigten Korrekturen. Eine dokumentierte Mitarbeiterfreigabe mit einmaliger Unterschrift wird unter „Freigaben“ erstellt.</span><button class="btn light" data-a="admin-view" data-view="approvals">Zu Freigaben</button></div>`;
    const preview=selected?reportSheet(reportData(selected,filtersValue.from,filtersValue.to),filtersValue.from,filtersValue.to):allEmployeesSummary(employees,filtersValue.from,filtersValue.to);
    return`${head("Arbeitszeitberichte","Aktuelle Buchungen prüfen, zusammenführen und als Live-Auswertung drucken.")}${intro}${filters(ownerMode,employees,filtersValue)}<div class="aora-report-preview-shell"><div class="aora-report-preview-label"><span>Live-Vorschau</span><small>A4 · keine Mitarbeiterunterschrift</small></div>${preview}</div>`;
  };

  window.aoraReportBuildPrintBundle=function(all=false){
    const filtersValue=filtersState(),employees=reportEmployees(typeof isOwner==="function"&&isOwner()),selected=employees.find(employee=>String(employee.id)===String(filtersValue.employeeId)),targets=all||!selected?employees:[selected];
    document.getElementById("aora-print-bundle")?.remove();
    const bundle=document.createElement("div");bundle.id="aora-print-bundle";bundle.innerHTML=targets.map(employee=>reportSheet(reportData(employee,filtersValue.from,filtersValue.to),filtersValue.from,filtersValue.to,{printOnly:true})).join("");
    document.body.appendChild(bundle);document.body.classList.add("aora-report-printing");
    const oldTitle=document.title;document.title=selected&&!all?`Live-Arbeitszeitbericht – ${selected.name}`:`Live-Arbeitszeitberichte – ${rangeLabel(filtersValue.from,filtersValue.to)}`;
    setTimeout(()=>{window.print();setTimeout(()=>{bundle.remove();document.body.classList.remove("aora-report-printing");document.title=oldTitle},250)},50);
  };
})();
