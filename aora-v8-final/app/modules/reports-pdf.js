"use strict";

(function installAoraReports(){
  const DEFAULT_RANGE=()=>{
    const today=String(berlin().date||new Date().toISOString().slice(0,10));
    return{from:`${today.slice(0,7)}-01`,to:today,employeeId:"all"};
  };

  function reportState(){
    if(!S.reportFilters)S.reportFilters=DEFAULT_RANGE();
    return S.reportFilters;
  }
  function reportEmployees(ownerMode=false){
    return(S.state.employees||[])
      .filter(employee=>employee.active!==false&&employee.status!=="pending"&&employee.status!=="revoked")
      .filter(employee=>ownerMode||employee.locationId===S.locationId)
      .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"de"));
  }
  function inRange(date,from,to){return Boolean(date)&&date>=from&&date<=to}
  function timeToMinutes(value){
    const match=String(value||"").match(/^(\d{1,2}):(\d{2})/);
    return match?Number(match[1])*60+Number(match[2]):0;
  }
  function formatMinutes(value,{signed=false}={}){
    const minutes=Math.round(Number(value)||0);
    const sign=minutes<0?"−":signed&&minutes>0?"+":"";
    const absolute=Math.abs(minutes);
    return`${sign}${String(Math.floor(absolute/60)).padStart(2,"0")}:${String(absolute%60).padStart(2,"0")}`;
  }
  function duration(item){
    if(!item?.start||!item?.end)return 0;
    const start=timeToMinutes(item.start),end=timeToMinutes(item.end);
    return Math.max(0,(end<start?end+1440:end)-start-Math.max(0,Number(item.breakMinutes)||0));
  }
  function overlap(start,end,rangeStart,rangeEnd){return Math.max(0,Math.min(end,rangeEnd)-Math.max(start,rangeStart))}
  function nightMinutes(item){
    if(!item?.start||!item?.end)return 0;
    let start=timeToMinutes(item.start),end=timeToMinutes(item.end);
    if(end<start)end+=1440;
    const gross=overlap(start,end,0,360)+overlap(start,end,1200,1440)+overlap(start,end,1440,1800);
    return Math.min(duration(item),gross);
  }
  function dateObject(date){return new Date(`${date}T12:00:00`)}
  function weekday(date){return new Intl.DateTimeFormat("de-DE",{weekday:"short"}).format(dateObject(date)).replace(".","")}
  function displayDate(date){return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}).format(dateObject(date))}
  function rangeLabel(from,to){return`${displayDate(from)} – ${displayDate(to)}`}
  function enumerateDates(from,to){
    const dates=[];
    let cursor=dateObject(from),end=dateObject(to),guard=0;
    while(cursor<=end&&guard<370){dates.push(cursor.toISOString().slice(0,10));cursor.setDate(cursor.getDate()+1);guard++}
    return dates;
  }
  function approvedLeave(employeeId,from,to){
    return(S.state.leaveRequests||[]).filter(item=>{
      const start=item.startDate||item.from||item.dateFrom||item.date;
      const end=item.endDate||item.to||item.dateTo||start;
      return item.employeeId===employeeId&&String(item.status||"").toLowerCase()!=="rejected"&&start<=to&&end>=from;
    });
  }
  function leaveKind(item){return String(item.type||item.kind||item.reason||"").toLowerCase()}
  function leaveDates(items,from,to,matcher){
    const dates=new Set();
    items.filter(matcher).forEach(item=>{
      const start=[item.startDate,item.from,item.dateFrom,item.date].find(Boolean)||from;
      const end=[item.endDate,item.to,item.dateTo,start].find(Boolean)||start;
      enumerateDates(start<from?from:start,end>to?to:end).forEach(date=>dates.add(date));
    });
    return dates;
  }
  function reportData(employee,from,to){
    const shifts=(S.state.shifts||[]).filter(item=>item.employeeId===employee.id&&inRange(item.date,from,to));
    const entries=(S.state.timeEntries||[]).filter(item=>item.employeeId===employee.id&&inRange(item.date,from,to));
    const closed=entries.filter(item=>item.end&&!["live","paused"].includes(item.status));
    const leave=approvedLeave(employee.id,from,to);
    const vacationDates=leaveDates(leave,from,to,item=>/urlaub|vacation|holiday/.test(leaveKind(item)));
    const sickDates=leaveDates(leave,from,to,item=>/krank|sick|ill/.test(leaveKind(item)));
    const planned=shifts.reduce((sum,item)=>sum+duration(item),0);
    const worked=closed.reduce((sum,item)=>sum+duration(item),0);
    const breaks=closed.reduce((sum,item)=>sum+Math.max(0,Number(item.breakMinutes)||0),0);
    const night=closed.reduce((sum,item)=>sum+nightMinutes(item),0);
    const sunday=closed.reduce((sum,item)=>sum+((dateObject(item.date).getDay()===0||item.isHoliday||item.holiday)?duration(item):0),0);
    const dailyTarget=Math.round((Number(employee.weeklyHours||employee.contractHours||40)*60)/5);
    const vacation=vacationDates.size*dailyTarget;
    const sick=sickDates.size*dailyTarget;
    const openEntries=entries.filter(item=>!item.end||["live","paused"].includes(item.status));
    const entryDates=new Set(entries.map(item=>item.date));
    const missingShifts=shifts.filter(item=>!entryDates.has(item.date));
    const rows=enumerateDates(from,to).map(date=>{
      const shift=shifts.find(item=>item.date===date);
      const entry=entries.find(item=>item.date===date);
      let type="–",start="–",end="–",breakValue="–",net="00:00",note="";
      if(vacationDates.has(date)){type="Urlaub";net=formatMinutes(dailyTarget);note="Genehmigte Abwesenheit"}
      else if(sickDates.has(date)){type="Krankheit";net=formatMinutes(dailyTarget);note="Abwesenheit"}
      else if(entry){
        type=entry.end?"Arbeit":"Offen";start=entry.start||"–";end=entry.end||"–";
        breakValue=formatMinutes(Number(entry.breakMinutes)||0);net=formatMinutes(duration(entry));
        note=!entry.end?"Clock-out fehlt":entry.note||entry.comment||"";
      }else if(shift){type="Fehlzeit";start=shift.start||"–";end=shift.end||"–";breakValue=formatMinutes(Number(shift.breakMinutes)||0);note="Keine Zeitbuchung"}
      else if([0,6].includes(dateObject(date).getDay()))type="Wochenende";
      return{date,day:weekday(date),start,end,breakValue,net,type,note};
    }).filter(row=>row.type!=="–"||![0,6].includes(dateObject(row.date).getDay()));
    return{employee,shifts,entries,rows,planned,worked,difference:worked-planned,overtime:Math.max(0,worked-planned),breaks,night,sunday,vacation,sick,workDays:new Set(closed.map(item=>item.date)).size,openEntries:openEntries.length,missingDays:missingShifts.length,status:openEntries.length||missingShifts.length?"Offen":"Bestätigt"};
  }
  function employeeMeta(employee){
    return{
      personnel:employee.personnelNumber||employee.employeeNumber||employee.staffNumber||`A-${String(employee.id||"").slice(-5).toUpperCase()}`,
      position:employee.position||employee.jobTitle||employee.role||"Mitarbeiter/in",
      department:employee.department||employee.team||loc(employee.locationId)?.name||"Betrieb",
      contract:employee.employmentType||employee.contractType||"Beschäftigt",
      target:`${Number(employee.weeklyHours||employee.contractHours||40)} Std./Woche`
    };
  }
  function metric(icon,label,value,sub=""){
    return`<div class="aora-report-metric"><div class="aora-report-metric-icon">${icon}</div><div><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:""}</div></div>`;
  }
  function reportTableRows(rows){
    const limited=rows.slice(0,35);
    return limited.map(row=>`<tr class="${row.type==="Offen"||row.type==="Fehlzeit"?"attention":""}"><td>${esc(displayDate(row.date))}</td><td>${esc(row.day)}</td><td>${esc(row.start)}</td><td>${esc(row.end)}</td><td>${esc(row.breakValue)}</td><td><strong>${esc(row.net)}</strong></td><td><span class="aora-report-type ${row.type.toLowerCase()}">${esc(row.type)}</span></td><td>${esc(row.note||"–")}</td></tr>`).join("")+(rows.length>limited.length?`<tr><td colspan="8" class="aora-report-more">+ ${rows.length-limited.length} weitere Tage im gewählten Zeitraum</td></tr>`:"");
  }
  function reportSheet(data,from,to,{printOnly=false}={}){
    const employee=data.employee,meta=employeeMeta(employee),location=loc(employee.locationId);
    const statusClass=data.status==="Bestätigt"?"confirmed":"open";
    return`<article class="aora-report-sheet ${printOnly?"print-only":""}">
      <header class="aora-report-document-head">
        <div class="aora-report-brand">${logo}<span>WORKFORCE</span></div>
        <div class="aora-report-document-title"><span>Arbeitszeitnachweis</span><strong>Stundenübersicht</strong></div>
        <div class="aora-report-created"><span>Erstellt am</span><strong>${esc(new Intl.DateTimeFormat("de-DE",{dateStyle:"medium",timeStyle:"short"}).format(new Date()))}</strong></div>
      </header>
      <div class="aora-report-period">${I.cal}<strong>${esc(rangeLabel(from,to))}</strong><span>${esc(location?.name||S.state.company?.name||"Aora")}</span></div>
      <section class="aora-report-person">
        <div class="aora-report-avatar">${esc(employee.initials||initials(employee.name||"A"))}</div>
        <div class="aora-report-person-main"><h2>${esc(employee.name||"Mitarbeiter/in")}</h2><p>${esc(meta.position)} · ${esc(meta.department)}</p></div>
        <dl><div><dt>Personalnummer</dt><dd>${esc(meta.personnel)}</dd></div><div><dt>Vertrag</dt><dd>${esc(meta.contract)}</dd></div><div><dt>Sollzeit</dt><dd>${esc(meta.target)}</dd></div></dl>
      </section>
      <section class="aora-report-summary">
        <h3>Zusammenfassung</h3>
        <div class="aora-report-metrics primary">
          ${metric(I.cal,"Geplant",formatMinutes(data.planned),"Dienstplan")}
          ${metric(I.clock,"Ist-Stunden",formatMinutes(data.worked),"Gebuchte Zeit")}
          ${metric(I.chart,"Differenz",formatMinutes(data.difference,{signed:true}),data.difference>=0?"Über Soll":"Unter Soll")}
          ${metric(I.clock,"Überstunden",formatMinutes(data.overtime),"Positiver Saldo")}
        </div>
        <div class="aora-report-metrics secondary">
          ${metric(I.clock,"Nachtstunden",formatMinutes(data.night))}
          ${metric(I.cal,"Sonntag/Feiertag",formatMinutes(data.sunday))}
          ${metric(I.umbrella,"Urlaub",formatMinutes(data.vacation))}
          ${metric(I.people,"Krankheit",formatMinutes(data.sick))}
          ${metric(I.clock,"Pausen",formatMinutes(data.breaks))}
        </div>
      </section>
      <section class="aora-report-daily">
        <div class="aora-report-section-head"><div><span>Tägliche Übersicht</span><strong>${data.rows.length} Kalendertage</strong></div><div class="aora-report-status ${statusClass}">${data.status==="Bestätigt"?I.check:I.clock}${esc(data.status)}</div></div>
        <div class="aora-report-table-wrap"><table class="aora-report-table"><thead><tr><th>Datum</th><th>Tag</th><th>Start</th><th>Ende</th><th>Pause</th><th>Netto</th><th>Typ</th><th>Bemerkung</th></tr></thead><tbody>${reportTableRows(data.rows)}</tbody><tfoot><tr><td colspan="5">Gesamtsumme</td><td>${esc(formatMinutes(data.worked))}</td><td colspan="2">Differenz ${esc(formatMinutes(data.difference,{signed:true}))}</td></tr></tfoot></table></div>
      </section>
      <section class="aora-report-footer-stats">
        <div><span>Arbeitstage</span><strong>${data.workDays}</strong></div><div><span>Offene Buchungen</span><strong>${data.openEntries}</strong></div><div><span>Unvollständige Tage</span><strong>${data.missingDays}</strong></div>
      </section>
      <footer class="aora-report-signatures"><div><span>Unterschrift Mitarbeiter/in</span><b></b></div><div><span>Unterschrift Vorgesetzte/r</span><b></b></div><div class="aora-report-final-status"><span>Status</span><strong class="${statusClass}">${esc(data.status)}</strong></div></footer>
      <div class="aora-report-page-footer"><span>Aora Zeiterfassungssystem</span><span>${esc(S.state.company?.name||"AoraAI Workforce")}</span></div>
    </article>`;
  }
  function allEmployeesSummary(employees,from,to){
    const datasets=employees.map(employee=>reportData(employee,from,to));
    const totals=datasets.reduce((acc,item)=>({planned:acc.planned+item.planned,worked:acc.worked+item.worked,difference:acc.difference+item.difference,overtime:acc.overtime+item.overtime}),{planned:0,worked:0,difference:0,overtime:0});
    return`<article class="aora-report-overview-card"><div class="aora-report-section-head"><div><span>Übersicht aller Mitarbeiter</span><strong>${esc(rangeLabel(from,to))}</strong></div><div class="aora-report-count">${employees.length} Personen</div></div>
      <div class="aora-report-metrics primary overview-metrics">${metric(I.cal,"Plan",formatMinutes(totals.planned))}${metric(I.clock,"Ist",formatMinutes(totals.worked))}${metric(I.chart,"Differenz",formatMinutes(totals.difference,{signed:true}))}${metric(I.clock,"Überstunden",formatMinutes(totals.overtime))}</div>
      <div class="aora-report-table-wrap"><table class="aora-report-table overview"><thead><tr><th>Mitarbeiter</th><th>Standort</th><th>Soll</th><th>Ist</th><th>Differenz</th><th>Urlaub</th><th>Krankheit</th><th>Status</th></tr></thead><tbody>${datasets.map(data=>`<tr><td><strong>${esc(data.employee.name||"–")}</strong></td><td>${esc(loc(data.employee.locationId)?.name||"–")}</td><td>${esc(formatMinutes(data.planned))}</td><td>${esc(formatMinutes(data.worked))}</td><td class="${data.difference<0?"negative":"positive"}">${esc(formatMinutes(data.difference,{signed:true}))}</td><td>${esc(formatMinutes(data.vacation))}</td><td>${esc(formatMinutes(data.sick))}</td><td><span class="aora-report-status ${data.status==="Bestätigt"?"confirmed":"open"}">${esc(data.status)}</span></td></tr>`).join("")||'<tr><td colspan="8">Keine Mitarbeiter vorhanden.</td></tr>'}</tbody></table></div></article>`;
  }
  function filters(ownerMode,employees,filters){
    return`<section class="aora-report-toolbar panel">
      <div class="aora-report-filter"><label for="report-employee">Mitarbeiter</label><select class="select" id="report-employee"><option value="all" ${filters.employeeId==="all"?"selected":""}>Alle Mitarbeiter</option>${employees.map(employee=>`<option value="${employee.id}" ${filters.employeeId===employee.id?"selected":""}>${esc(employee.name)}${ownerMode?` · ${esc(loc(employee.locationId)?.name||"")}`:""}</option>`).join("")}</select></div>
      <div class="aora-report-filter"><label for="report-from">Von</label><input class="input" id="report-from" type="date" value="${esc(filters.from)}"></div>
      <div class="aora-report-filter"><label for="report-to">Bis</label><input class="input" id="report-to" type="date" value="${esc(filters.to)}"></div>
      <div class="aora-report-toolbar-actions"><button class="btn outline" data-a="report-print-all">Alle als PDF</button><button class="btn" data-a="report-print">${I.chart} PDF erstellen</button></div>
    </section>`;
  }
  function reportsPageAora(ownerMode=false){
    const filtersState=reportState(),employees=reportEmployees(ownerMode);
    if(filtersState.employeeId!=="all"&&!employees.some(employee=>employee.id===filtersState.employeeId))filtersState.employeeId="all";
    const selected=employees.find(employee=>employee.id===filtersState.employeeId);
    const title=head("Arbeitszeitberichte","Prüfen, vergleichen und als druckfertiges A4-PDF ausgeben.");
    const preview=selected?reportSheet(reportData(selected,filtersState.from,filtersState.to),filtersState.from,filtersState.to):allEmployeesSummary(employees,filtersState.from,filtersState.to);
    return`${title}${filters(ownerMode,employees,filtersState)}<div class="aora-report-preview-shell"><div class="aora-report-preview-label"><span>PDF-Vorschau</span><small>A4 · Minimal Aora UI</small></div>${preview}</div>`;
  }

  window.aoraReportBuildPrintBundle=function(all=false){
    const filters=reportState();
    const ownerMode=isOwner();
    const employees=reportEmployees(ownerMode);
    const selected=employees.find(employee=>employee.id===filters.employeeId);
    const targets=all||!selected?employees:[selected];
    const bundle=document.createElement("div");
    bundle.id="aora-print-bundle";
    bundle.innerHTML=targets.map(employee=>reportSheet(reportData(employee,filters.from,filters.to),filters.from,filters.to,{printOnly:true})).join("");
    document.body.appendChild(bundle);
    document.body.classList.add("aora-report-printing");
    const oldTitle=document.title;
    document.title=selected&&!all?`Arbeitszeitnachweis – ${selected.name}`:`Arbeitszeitnachweise – ${rangeLabel(filters.from,filters.to)}`;
    setTimeout(()=>{
      window.print();
      setTimeout(()=>{bundle.remove();document.body.classList.remove("aora-report-printing");document.title=oldTitle},250);
    },50);
  };

  reportsPage=reportsPageAora;

  document.addEventListener("change",event=>{
    if(!["report-employee","report-from","report-to"].includes(event.target?.id))return;
    const filters=reportState();
    if(event.target.id==="report-employee")filters.employeeId=event.target.value;
    if(event.target.id==="report-from")filters.from=event.target.value;
    if(event.target.id==="report-to")filters.to=event.target.value;
    if(filters.from>filters.to){const swap=filters.from;filters.from=filters.to;filters.to=swap}
    renderAdmin();
  });
  document.addEventListener("click",event=>{
    const action=event.target.closest("[data-a]")?.dataset.a;
    if(action==="report-print"){event.preventDefault();window.aoraReportBuildPrintBundle(false)}
    if(action==="report-print-all"){event.preventDefault();window.aoraReportBuildPrintBundle(true)}
  });
})();
