"use strict";

(function installUnifiedWorktimeCenter(){
  const VIEW="worktime";
  const FUNCTION_NAME="aora-v8-worktime-center";
  const state={
    tab:"overview",
    loading:false,
    error:"",
    loadedAt:0,
    data:null,
    filters:{employeeId:"all",status:"all"}
  };

  const html=value=>typeof esc==="function"?esc(value??""):String(value??"");
  const clean=value=>String(value??"").replace(/\s+/g," ").trim();
  const today=()=>typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10);
  const entryId=item=>String(item?.id||item?.time_entry_id||item?.timeEntryId||"");
  const employeeIdOf=item=>String(item?.employeeId??item?.employee_id??"");
  const locationIdOf=item=>String(item?.locationId??item?.location_id??"");
  const entryDate=item=>String(item?.date||item?.startTime||item?.start_time||"").slice(0,10);
  const entryStart=item=>{
    const value=String(item?.start||item?.startTime||item?.start_time||"");
    return value.includes("T")?value.slice(11,16):value.slice(0,5);
  };
  const entryEnd=item=>{
    const value=String(item?.end||item?.endTime||item?.end_time||"");
    return value.includes("T")?value.slice(11,16):value.slice(0,5);
  };
  const entryBreak=item=>Math.max(0,Number(item?.breakMinutes??item?.break_minutes??0)||0);
  const correctionEmployeeId=item=>String(item?.employee_id??item?.employeeId??"");
  const correctionTarget=item=>String(item?.approval_target||((item?.requested_by_type||"")==="employee"?"manager":"employee"));
  const correctionStatus=item=>String(item?.status||"pending");
  const correctionPrevious=item=>item?.previous_value||item?.previousValue||{};
  const correctionProposed=item=>item?.proposed_value||item?.proposedValue||{};
  const correctionReason=item=>String(item?.reason||"");
  const employeeName=id=>typeof emp==="function"?emp(id)?.name||id:id;
  const formatDate=value=>{
    if(!value)return"–";
    try{return typeof fd==="function"?fd(String(value).slice(0,10),{weekday:true}):new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString("de-DE",{timeZone:"UTC"})}
    catch{return String(value)}
  };
  const formatDateTime=value=>{if(!value)return"–";try{return new Date(value).toLocaleString("de-DE")}catch{return String(value)}};
  const minutesText=value=>typeof fm==="function"?fm(Number(value||0)):`${Math.floor(Number(value||0)/60)}:${String(Number(value||0)%60).padStart(2,"0")} Std.`;
  const entryMinutes=item=>{
    if(Number.isFinite(Number(item?.durationMinutes??item?.duration_minutes)))return Number(item?.durationMinutes??item?.duration_minutes);
    if(typeof activeEntryMinutes==="function")return activeEntryMinutes(item);
    if(entryStart(item)&&entryEnd(item)&&typeof mins==="function")return mins(entryStart(item),entryEnd(item),entryBreak(item));
    return 0;
  };
  const currentEntry=employeeId=>(S.state?.timeEntries||[]).find(item=>employeeIdOf(item)===String(employeeId)&&["live","paused"].includes(String(item.status||"")));
  const scopedEmployees=()=>{
    const remote=state.data?.employees;
    if(Array.isArray(remote))return remote;
    return(S.state?.employees||[]).filter(item=>item.active!==false&&item.status!=="revoked"&&item.status!=="pending");
  };
  const scopedEntries=()=>{
    const allowed=new Set(scopedEmployees().map(item=>String(item.id)));
    return(S.state?.timeEntries||[]).filter(item=>allowed.has(employeeIdOf(item)));
  };
  const corrections=()=>Array.isArray(state.data?.corrections)?state.data.corrections:[];

  function call(action,payload={}){
    return request(FUNCTION_NAME,{action,token:S.session?.token,...payload});
  }
  async function ensureData(force=false){
    if(state.loading)return;
    if(!force&&state.loadedAt&&Date.now()-state.loadedAt<12000)return;
    state.loading=true;state.error="";
    try{state.data=await call("overview");state.loadedAt=Date.now()}
    catch(error){state.error=error?.message||"Arbeitszeitdaten konnten nicht geladen werden."}
    finally{
      state.loading=false;
      if(S.session&&S.adminView===VIEW)renderAdmin();
      if(S.session&&S.accessRole==="employee"&&S.employeeView==="time")renderEmployee();
    }
  }

  function consolidateNavigation(list,anchor){
    if(!Array.isArray(list))return;
    const remove=new Set(["time","reports","time-control","approvals",VIEW]);
    for(let index=list.length-1;index>=0;index-=1)if(remove.has(list[index]?.[0]))list.splice(index,1);
    const anchorIndex=list.findIndex(([id])=>id===anchor);
    list.splice(anchorIndex>=0?anchorIndex+1:Math.min(3,list.length),0,[VIEW,"Arbeitszeit",I.clock]);
    const compliance=list.find(item=>item?.[0]==="compliance");
    if(compliance)compliance[1]="Prüfung & Exporte";
  }
  consolidateNavigation(typeof managerNav!=="undefined"?managerNav:null,"schedule");
  consolidateNavigation(typeof ownerNav!=="undefined"?ownerNav:null,"operations");

  const previousAdminTitle=adminTitle;
  const previousAdminView=adminView;
  adminTitle=function(){return S.adminView===VIEW?"Arbeitszeit":S.adminView==="compliance"?"Prüfung & Exporte":previousAdminTitle()};
  adminView=function(){
    if(S.adminView===VIEW)return managerCenter();
    if(S.adminView==="compliance")return auditExportPage();
    return previousAdminView();
  };

  function legacyView(id){
    const current=S.adminView;
    S.adminView=id;
    try{return previousAdminView()}
    finally{S.adminView=current}
  }

  const tabs=[
    ["overview","Übersicht"],
    ["entries","Buchungen"],
    ["changes","Änderungen"],
    ["documents","Nachweise"],
    ["reports","Berichte"]
  ];
  function tabBar(){
    return`<nav class="worktime-tabs" aria-label="Arbeitszeit Bereiche">${tabs.map(([id,label])=>`<button class="${state.tab===id?"active":""}" data-worktime-action="tab" data-tab="${id}">${html(label)}${id==="changes"&&pendingActionCount()?`<b>${pendingActionCount()}</b>`:""}</button>`).join("")}</nav>`;
  }
  function pendingActionCount(){
    return corrections().filter(item=>correctionStatus(item)==="pending"&&correctionTarget(item)==="manager").length;
  }
  function managerCenter(){
    queueMicrotask(()=>ensureData());
    return`<section class="worktime-center">
      <header class="worktime-hero"><div><div class="caps">Ein Ort für alle Arbeitszeiten</div><h2>Stempeln, prüfen, ändern und abschließen.</h2><p>Live-Aktionen wirken sofort. Änderungen an abgeschlossenen Zeiten werden erst nach Bestätigung der richtigen Person übernommen.</p></div><button class="btn light" data-worktime-action="refresh">Aktualisieren</button></header>
      ${state.error?`<div class="compliance-alert">${html(state.error)}</div>`:""}
      ${tabBar()}
      <div class="worktime-tab-content">${state.tab==="overview"?overviewTab():state.tab==="entries"?entriesTab():state.tab==="changes"?changesTab():state.tab==="documents"?legacyView("approvals"):legacyView("reports")}</div>
    </section>`;
  }

  function overviewTab(){
    const employees=scopedEmployees();
    const entries=scopedEntries();
    const active=employees.filter(item=>currentEntry(item.id));
    const paused=active.filter(item=>currentEntry(item.id)?.status==="paused");
    const pendingEmployee=corrections().filter(item=>correctionStatus(item)==="pending"&&correctionTarget(item)==="employee").length;
    const todayCompleted=entries.filter(item=>entryDate(item)===today()&&entryEnd(item)).length;
    return`<div class="admin-kpis worktime-kpis">
      ${adminKpi(I.clock,"Im Dienst",active.length,"Live gestempelt")}
      ${adminKpi(I.clock,"In Pause",paused.length,"Aktuelle Pausen")}
      ${adminKpi(I.news,"Warten auf Mitarbeiter",pendingEmployee,"Manager-Änderungen")}
      ${adminKpi(I.cal,"Heute abgeschlossen",todayCompleted,"Vollständige Buchungen")}
    </div>
    <div class="worktime-explainer"><div><strong>Direkte Aktion</strong><span>Ein-/Ausstempeln und Pause wirken sofort. Eine Begründung wird im Audit gespeichert.</span></div><div><strong>Nachträgliche Änderung</strong><span>Start, Ende, Datum oder Pause werden erst nach Zustimmung des Mitarbeiters übernommen.</span></div></div>
    <article class="dashboard-card worktime-card"><div class="dashboard-card-head"><h2>Mitarbeiterstatus <small>${employees.length}</small></h2><button class="btn outline" data-worktime-action="open-change" data-change-type="create_entry">Fehlende Buchung hinzufügen</button></div>
      <div class="worktime-people">${employees.map(employeeCard).join("")||'<div class="empty">Keine Mitarbeiter vorhanden.</div>'}</div>
    </article>`;
  }
  function employeeCard(employee){
    const live=currentEntry(employee.id);
    const status=live?.status==="paused"?"In Pause":live?"Im Dienst":"Nicht eingestempelt";
    const detail=live?`${entryStart(live)} · ${minutesText(entryMinutes(live))}`:"Keine laufende Arbeitszeit";
    const actions=!live
      ?`<button class="btn" data-worktime-action="open-punch" data-employee-id="${html(employee.id)}" data-punch="in">Einstempeln</button>`
      :live.status==="paused"
        ?`<button class="btn light" data-worktime-action="open-punch" data-employee-id="${html(employee.id)}" data-punch="resume">Pause beenden</button><button class="btn" data-worktime-action="open-punch" data-employee-id="${html(employee.id)}" data-punch="out">Ausstempeln</button>`
        :`<button class="btn light" data-worktime-action="open-punch" data-employee-id="${html(employee.id)}" data-punch="pause">Pause starten</button><button class="btn" data-worktime-action="open-punch" data-employee-id="${html(employee.id)}" data-punch="out">Ausstempeln</button>`;
    return`<article class="worktime-person"><span class="avatar">${html(employee.initials||initials(employee.name||""))}</span><div class="worktime-person-main"><strong>${html(employee.name||"Mitarbeiter/in")}</strong><small>${html(loc(employee.locationId||employee.primaryLocationId)?.name||"Standort")} · ${html(status)}</small><p>${html(detail)}</p></div><div class="worktime-person-actions">${actions}</div></article>`;
  }

  function entriesTab(){
    const employees=scopedEmployees();
    const employeeFilter=state.filters.employeeId;
    const statusFilter=state.filters.status;
    const entries=scopedEntries().filter(item=>employeeFilter==="all"||employeeIdOf(item)===employeeFilter).filter(item=>statusFilter==="all"||String(item.status||"completed")===statusFilter).sort((a,b)=>`${entryDate(b)}${entryStart(b)}`.localeCompare(`${entryDate(a)}${entryStart(a)}`));
    return`<article class="dashboard-card worktime-card"><div class="dashboard-card-head"><div><h2>Buchungen <small>${entries.length}</small></h2><p class="small muted">Abgeschlossene Zeiten können vorgeschlagen werden. Die Änderung wird erst nach Mitarbeiterbestätigung wirksam.</p></div><button class="btn" data-worktime-action="open-change" data-change-type="create_entry">Fehlende Buchung</button></div>
      <div class="worktime-filters"><label>Mitarbeiter<select class="select" data-worktime-filter="employeeId"><option value="all">Alle Mitarbeiter</option>${employees.map(item=>`<option value="${html(item.id)}" ${employeeFilter===String(item.id)?"selected":""}>${html(item.name)}</option>`).join("")}</select></label><label>Status<select class="select" data-worktime-filter="status"><option value="all">Alle</option><option value="completed" ${statusFilter==="completed"?"selected":""}>Abgeschlossen</option><option value="live" ${statusFilter==="live"?"selected":""}>Im Dienst</option><option value="paused" ${statusFilter==="paused"?"selected":""}>Pause</option></select></label></div>
      <div class="worktime-entry-list">${entries.map(managerEntryRow).join("")||'<div class="empty">Keine Buchungen gefunden.</div>'}</div>
    </article>`;
  }
  function managerEntryRow(item){
    const live=["live","paused"].includes(String(item.status||""))||!entryEnd(item);
    const employee=typeof emp==="function"?emp(employeeIdOf(item)):null;
    return`<article class="worktime-entry"><div><strong>${html(employee?.name||employeeIdOf(item))}</strong><small>${html(formatDate(entryDate(item)))} · ${html(entryStart(item)||"–")}–${html(entryEnd(item)||"läuft")} · Pause ${entryBreak(item)} Min.</small><p>${html(item.source==="manager_direct"?"Durch Manager gestempelt":item.correctedAt?"Nachträglich korrigiert":"Reguläre Buchung")}</p></div><span class="status-chip ${live?"black":""}">${html(item.status||"completed")}</span><b>${html(minutesText(entryMinutes(item)))}</b><div class="worktime-entry-actions">${live?`<button class="btn" data-worktime-action="open-punch" data-employee-id="${html(employeeIdOf(item))}" data-punch="out">Jetzt ausstempeln</button>`:`<button class="btn outline" data-worktime-action="open-change" data-change-type="edit_entry" data-entry-id="${html(entryId(item))}">Änderung vorschlagen</button>`}</div></article>`;
  }

  function changesTab(){
    const rows=corrections();
    const incoming=rows.filter(item=>correctionTarget(item)==="manager");
    const outgoing=rows.filter(item=>correctionTarget(item)==="employee");
    return`<div class="worktime-change-columns">
      <article class="dashboard-card worktime-card"><div class="dashboard-card-head"><div><h2>Mitarbeiter → Manager <small>${incoming.length}</small></h2><p class="small muted">Korrekturen, die du prüfen und entscheiden musst.</p></div></div><div class="worktime-change-list">${incoming.map(item=>changeRow(item,true)).join("")||'<div class="empty">Keine Mitarbeiteranfragen.</div>'}</div></article>
      <article class="dashboard-card worktime-card"><div class="dashboard-card-head"><div><h2>Manager → Mitarbeiter <small>${outgoing.length}</small></h2><p class="small muted">Deine Vorschläge. Nur der betroffene Mitarbeiter kann sie bestätigen.</p></div></div><div class="worktime-change-list">${outgoing.map(item=>changeRow(item,false)).join("")||'<div class="empty">Keine offenen Manager-Änderungen.</div>'}</div></article>
    </div>`;
  }
  function changeSummary(item){
    const before=correctionPrevious(item),after=correctionProposed(item);
    const beforeText=[before.date,before.start&&before.end?`${before.start}–${before.end}`:null,before.breakMinutes!==undefined?`Pause ${before.breakMinutes}`:null].filter(Boolean).join(" · ")||"Keine Buchung";
    const afterText=[after.date,after.start&&after.end?`${after.start}–${after.end}`:null,after.breakMinutes!==undefined?`Pause ${after.breakMinutes}`:null].filter(Boolean).join(" · ")||"Keine Änderung";
    return{beforeText,afterText};
  }
  function changeRow(item,managerDecision){
    const status=correctionStatus(item),summary=changeSummary(item),pending=status==="pending";
    return`<article class="worktime-change"><div class="worktime-change-head"><div><strong>${html(employeeName(correctionEmployeeId(item)))}</strong><small>${html(formatDateTime(item.requested_at||item.requestedAt))} · ${item.change_type==="create_entry"?"Neue Buchung":"Zeitänderung"}</small></div><span class="status-chip ${status==="approved"?"black":status==="rejected"?"danger":""}">${status==="approved"?"Bestätigt":status==="rejected"?"Abgelehnt":managerDecision?"Entscheidung offen":"Wartet auf Mitarbeiter"}</span></div><div class="worktime-diff"><div><span>Vorher</span><strong>${html(summary.beforeText)}</strong></div><div><span>Vorgeschlagen</span><strong>${html(summary.afterText)}</strong></div></div><p>${html(correctionReason(item))}</p>${pending&&managerDecision?`<div class="worktime-change-actions"><button class="btn light" data-worktime-action="decide" data-id="${html(item.id)}" data-decision="rejected">Ablehnen</button><button class="btn" data-worktime-action="decide" data-id="${html(item.id)}" data-decision="approved">Genehmigen</button></div>`:""}</article>`;
  }

  function auditExportPage(){
    if(typeof ensureComplianceData==="function")queueMicrotask(()=>ensureComplianceData());
    const summary=typeof aoraComplianceState!=="undefined"?aoraComplianceState.summary||{}:{};
    const retention=summary.retention||{};
    return`<div class="compliance-header"><div><div class="caps">Kontrolle im Hintergrund</div><h2>Prüfung, Exporte und Backup</h2><p>Hier liegen nur technische und rechtliche Nachweise. Die tägliche Arbeitszeitbearbeitung findest du unter „Arbeitszeit“.</p></div></div>
      <div class="admin-kpis compliance-kpis">${adminKpi(I.chart,"Fehler letzte 24h",summary.recentErrors??"–","Monitoring")}${adminKpi(I.cal,"Arbeitszeit-Aufbewahrung",retention.time_entry_months?`${retention.time_entry_months} Monate`:"–","Retention")}${adminKpi(I.news,"Audit",retention.audit_months?`${retention.audit_months} Monate`:"–","Nachvollziehbarkeit")}${adminKpi(I.clock,"Letztes Backup",summary.lastBackup?.created_at?formatDateTime(summary.lastBackup.created_at):"–","Systemstatus")}</div>
      <div class="compliance-grid"><article class="dashboard-card"><div class="dashboard-card-head"><h2>Technische Exporte</h2></div><div class="compliance-actions"><button class="btn outline" data-compliance-action="export" data-format="csv">CSV Arbeitszeit</button><button class="btn outline" data-compliance-action="export" data-format="audit">Audit JSON</button><button class="btn outline" data-compliance-action="export" data-format="steuerberater">Steuerberater CSV</button></div><p class="small muted">Für den normalen PDF-/Excel-Arbeitszeitnachweis nutze Arbeitszeit → Nachweise.</p></article><article class="dashboard-card"><div class="dashboard-card-head"><h2>Backup</h2></div>${typeof isOwner==="function"&&isOwner()?'<button class="btn" data-compliance-action="backup">Verifiziertes Snapshot erstellen</button>':'<p class="small muted">Backups können nur vom Inhaber erstellt werden.</p>'}</article></div>`;
  }

  function ensureDialog(){
    let dialog=document.getElementById("aora-worktime-dialog");
    if(!dialog){dialog=document.createElement("dialog");dialog.id="aora-worktime-dialog";dialog.className="aora-worktime-dialog";document.body.appendChild(dialog)}
    return dialog;
  }
  function openPunchDialog(employeeId,punch){
    const employee=scopedEmployees().find(item=>String(item.id)===String(employeeId));
    const labels={in:"Einstempeln",out:"Ausstempeln",pause:"Pause starten",resume:"Pause beenden"};
    const dialog=ensureDialog();
    dialog.innerHTML=`<form method="dialog" id="worktime-punch-form"><input type="hidden" name="employeeId" value="${html(employeeId)}"><input type="hidden" name="punchAction" value="${html(punch)}"><div class="dialog-head"><div><div class="caps">Direkte Manager-Aktion</div><h2>${html(labels[punch]||"Stempeln")} · ${html(employee?.name||"")}</h2></div><button type="button" class="circle-btn" data-worktime-action="close-dialog">${I.x}</button></div><div class="worktime-immediate-note"><strong>Sofort wirksam</strong><span>Diese Aktion benötigt keine Mitarbeiterbestätigung. Mitarbeiter und Audit-Protokoll erhalten den Grund.</span></div><label class="field">Begründung<textarea class="input" name="reason" minlength="5" required placeholder="z. B. Mitarbeiter hat das Ausstempeln vergessen"></textarea></label><div class="dialog-actions"><button type="button" class="btn light" data-worktime-action="close-dialog">Abbrechen</button><button class="btn" type="submit">${html(labels[punch]||"Ausführen")}</button></div></form>`;
    dialog.showModal();
  }
  function openChangeDialog(changeType,entryIdValue=""){
    const employees=scopedEmployees();
    const entry=(S.state?.timeEntries||[]).find(item=>entryId(item)===String(entryIdValue));
    const selectedEmployee=entry?employeeIdOf(entry):(state.filters.employeeId!=="all"?state.filters.employeeId:String(employees[0]?.id||""));
    const dialog=ensureDialog();
    dialog.innerHTML=`<form method="dialog" id="worktime-change-form"><input type="hidden" name="changeType" value="${html(changeType)}"><input type="hidden" name="timeEntryId" value="${html(entryIdValue)}"><div class="dialog-head"><div><div class="caps">Mit Mitarbeiterbestätigung</div><h2>${changeType==="create_entry"?"Fehlende Buchung vorschlagen":"Arbeitszeit ändern"}</h2></div><button type="button" class="circle-btn" data-worktime-action="close-dialog">${I.x}</button></div><div class="worktime-approval-note"><strong>Erst nach Bestätigung wirksam</strong><span>Der Mitarbeiter sieht Vorher/Nachher und kann zustimmen oder ablehnen.</span></div><div class="form-grid"><label class="field">Mitarbeiter<select class="select" name="employeeId" ${entry?"disabled":""}>${employees.map(item=>`<option value="${html(item.id)}" ${String(item.id)===selectedEmployee?"selected":""}>${html(item.name)}</option>`).join("")}</select>${entry?`<input type="hidden" name="employeeId" value="${html(selectedEmployee)}">`:""}</label><label class="field">Datum<input class="input" type="date" name="date" required value="${html(entryDate(entry)||today())}"></label><label class="field">Start<input class="input" type="time" name="start" required value="${html(entryStart(entry)||"")}"></label><label class="field">Ende<input class="input" type="time" name="end" required value="${html(entryEnd(entry)||"")}"></label><label class="field">Pause (Min.)<input class="input" type="number" min="0" max="720" name="breakMinutes" required value="${html(entryBreak(entry))}"></label></div><label class="field">Begründung<textarea class="input" name="reason" minlength="5" required placeholder="Was soll geändert werden und warum?"></textarea></label><div class="dialog-actions"><button type="button" class="btn light" data-worktime-action="close-dialog">Abbrechen</button><button class="btn" type="submit">An Mitarbeiter senden</button></div></form>`;
    dialog.showModal();
  }

  async function refreshAfterMutation(){
    state.loadedAt=0;
    await loadState(true);
    await ensureData(true);
  }
  async function decide(button){
    const decision=button.dataset.decision;
    const reason=decision==="rejected"?prompt("Warum lehnst du die Änderung ab? (mindestens 5 Zeichen)",""):"";
    if(decision==="rejected"&&clean(reason).length<5)return toast("Bitte eine kurze Begründung angeben.","error");
    button.disabled=true;
    try{await call("decideChange",{correctionId:button.dataset.id,decision,decisionReason:clean(reason)});toast(decision==="approved"?"Änderung wurde genehmigt.":"Änderung wurde abgelehnt.");await refreshAfterMutation()}
    catch(error){toast(error?.message||"Änderung konnte nicht entschieden werden.","error")}
    finally{if(button.isConnected)button.disabled=false}
  }

  document.addEventListener("click",async event=>{
    const button=event.target.closest?.("[data-worktime-action]");
    if(!button)return;
    const action=button.dataset.worktimeAction;
    if(action==="tab"){state.tab=button.dataset.tab||"overview";renderAdmin();return}
    if(action==="refresh"){await ensureData(true);return}
    if(action==="open-punch"){openPunchDialog(button.dataset.employeeId,button.dataset.punch);return}
    if(action==="open-change"){openChangeDialog(button.dataset.changeType||"edit_entry",button.dataset.entryId||"");return}
    if(action==="close-dialog"){button.closest("dialog")?.close();return}
    if(action==="decide"){await decide(button);return}
    if(action==="employee-decide"){
      const decision=button.dataset.decision;
      const reason=decision==="rejected"?prompt("Warum lehnst du die Änderung ab? (mindestens 5 Zeichen)",""):"";
      if(decision==="rejected"&&clean(reason).length<5)return toast("Bitte eine kurze Begründung angeben.","error");
      button.disabled=true;
      try{await call("decideChange",{correctionId:button.dataset.id,decision,decisionReason:clean(reason)});toast(decision==="approved"?"Arbeitszeit wurde bestätigt.":"Änderung wurde abgelehnt.");await refreshAfterMutation()}
      catch(error){toast(error?.message||"Entscheidung konnte nicht gespeichert werden.","error")}
      finally{if(button.isConnected)button.disabled=false}
    }
  });

  document.addEventListener("change",event=>{
    const field=event.target.closest?.("[data-worktime-filter]");
    if(!field)return;
    state.filters[field.dataset.worktimeFilter]=field.value;
    if(S.adminView===VIEW)renderAdmin();
  });

  document.addEventListener("submit",async event=>{
    if(!["worktime-punch-form","worktime-change-form"].includes(event.target?.id))return;
    event.preventDefault();
    const form=event.target,data=new FormData(form),submit=form.querySelector('button[type="submit"]');
    submit.disabled=true;
    try{
      if(form.id==="worktime-punch-form"){
        await call("managerPunch",{employeeId:String(data.get("employeeId")||""),punchAction:String(data.get("punchAction")||""),reason:clean(data.get("reason"))});
        toast("Stempelstatus wurde sofort aktualisiert.");
      }else{
        await call("managerRequestChange",{changeType:String(data.get("changeType")||"edit_entry"),timeEntryId:String(data.get("timeEntryId")||""),employeeId:String(data.get("employeeId")||""),date:String(data.get("date")||""),start:String(data.get("start")||""),end:String(data.get("end")||""),breakMinutes:Number(data.get("breakMinutes")||0),reason:clean(data.get("reason"))});
        toast("Änderung wurde an den Mitarbeiter zur Bestätigung gesendet.");
      }
      form.closest("dialog")?.close();
      await refreshAfterMutation();
    }catch(error){toast(error?.message||"Aktion konnte nicht gespeichert werden.","error")}
    finally{if(submit.isConnected)submit.disabled=false}
  });

  const previousEmployeeView=employeeView;
  employeeView=function(employee,view){
    const base=previousEmployeeView(employee,view);
    if(view!=="time")return base;
    queueMicrotask(()=>ensureData());
    const pending=corrections().filter(item=>correctionEmployeeId(item)===String(employee.id)&&correctionTarget(item)==="employee"&&correctionStatus(item)==="pending");
    if(!pending.length)return base;
    return`<section class="worktime-employee-approvals"><div class="worktime-employee-approvals-head"><div><div class="caps">Bitte prüfen</div><h2>${pending.length} Änderung${pending.length===1?"":"en"} durch deinen Manager</h2><p>Die Änderung wird erst nach deiner Bestätigung in deine Arbeitszeit übernommen.</p></div></div>${pending.map(employeeApprovalCard).join("")}</section>${base}`;
  };
  function employeeApprovalCard(item){
    const summary=changeSummary(item);
    return`<article class="worktime-employee-approval"><div><strong>${item.change_type==="create_entry"?"Neue Arbeitszeit":"Änderung deiner Arbeitszeit"}</strong><small>${html(formatDateTime(item.requested_at||item.requestedAt))}</small></div><div class="worktime-diff"><div><span>Bisher</span><strong>${html(summary.beforeText)}</strong></div><div><span>Neu</span><strong>${html(summary.afterText)}</strong></div></div><p><strong>Grund:</strong> ${html(correctionReason(item))}</p><div class="worktime-change-actions"><button class="btn light" data-worktime-action="employee-decide" data-id="${html(item.id)}" data-decision="rejected">Ablehnen</button><button class="btn" data-worktime-action="employee-decide" data-id="${html(item.id)}" data-decision="approved">Bestätigen</button></div></article>`;
  }
})();
