"use strict";

function employeeScopedState(employee){
  const state=S.state||{};
  const employeeId=employee.id;
  const locationId=employee.locationId||S.session.locationId;
  const assignments=(state.checklistAssignments||[]).filter(item=>item.employeeId===employeeId);
  const templateIds=new Set(assignments.map(item=>item.templateId));
  return{
    ...state,
    employees:[employee],
    admins:[],
    locations:(state.locations||[]).filter(item=>item.id===locationId),
    shifts:(state.shifts||[]).filter(item=>item.employeeId===employeeId||(item.status==="open"&&item.locationId===locationId)),
    timeEntries:(state.timeEntries||[]).filter(item=>item.employeeId===employeeId),
    leaveRequests:(state.leaveRequests||[]).filter(item=>item.employeeId===employeeId),
    correctionRequests:(state.correctionRequests||[]).filter(item=>item.employeeId===employeeId),
    notifications:(state.notifications||[]).filter(item=>item.employeeId===employeeId),
    announcements:(state.announcements||[]).filter(item=>item.audience==="all"||item.audience===locationId),
    kioskDevices:(state.kioskDevices||[]).filter(item=>item.locationId===locationId),
    clockRequests:(state.clockRequests||[]).filter(item=>item.employeeId===employeeId),
    availabilityRules:(state.availabilityRules||[]).filter(item=>item.employeeId===employeeId),
    shiftRequests:(state.shiftRequests||[]).filter(item=>item.employeeId===employeeId||item.targetEmployeeId===employeeId),
    checklistAssignments:assignments,
    checklistTemplates:(state.checklistTemplates||[]).filter(item=>templateIds.has(item.id)),
    dailyLogs:[],
    audit:[],
    timesheetPeriods:[],
    staffingRequirements:[],
    shiftFeedback:(state.shiftFeedback||[]).filter(item=>item.employeeId===employeeId),
    invitations:[]
  };
}

function activeEntryMinutes(entry){
  const start=entry.start||entry.startTime;
  const end=entry.end||entry.endTime;
  if(end)return mins(start,end,entry.breakMinutes);
  if(!["live","paused"].includes(entry.status)||!start)return 0;
  const today=berlin().date;
  if(entry.date&&entry.date!==today)return 0;
  const effectiveEnd=entry.status==="paused"?(entry.pauseStartedAt||berlin().time):berlin().time;
  return mins(start,effectiveEnd,entry.breakMinutes);
}

function employeeStats(employee){
  const weekStart=startWeek();
  const weekEnd=addDays(weekStart,6);
  const shifts=(S.state.shifts||[]).filter(item=>item.employeeId===employee.id&&item.date>=weekStart&&item.date<=weekEnd);
  const entries=(S.state.timeEntries||[]).filter(item=>item.employeeId===employee.id&&item.date>=weekStart&&item.date<=weekEnd);
  const planned=shifts.reduce((sum,item)=>sum+mins(item.start,item.end,item.breakMinutes),0);
  const worked=entries.reduce((sum,item)=>sum+activeEntryMinutes(item),0);
  const remaining=Math.max(0,Number(employee.vacationAllowance||0)-Number(employee.vacationUsed||0));
  return{shifts,entries,planned,worked,balance:worked-planned,remaining};
}

function clockTargetLabel(target){
  return({in:"Arbeitszeit starten",pause:"Pause starten",resume:"Pause beenden",out:"Arbeitszeit beenden"})[target]||"Zeiterfassung bestätigen";
}

function pendingClockRequest(employee){
  const current=Date.now();
  return(S.state.clockRequests||[])
    .filter(item=>item.employeeId===employee.id&&item.status==="pending"&&new Date(item.expiresAt).getTime()>current)
    .sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())[0]||null;
}

function clockApprovalPanel(employee){
  const request=pendingClockRequest(employee);
  if(!request)return"";
  const expiresIn=Math.max(0,Math.ceil((new Date(request.expiresAt).getTime()-Date.now())/1000));
  const warnings=(request.policyWarnings||[]).map(item=>`<li>${esc(item)}</li>`).join("");
  return`<section class="panel" data-clock-request-panel style="margin:0 0 18px;padding:18px;border:2px solid #000">
    <div class="caps muted">Sichere Kiosk-Bestätigung</div>
    <h2 style="margin-top:8px">${esc(clockTargetLabel(request.target))}</h2>
    <p class="small muted" style="margin-top:8px">Kiosk ${esc(loc(request.locationId)?.name||request.locationId||"")} · ${esc(request.time||"")} · <span data-clock-request-expires="${esc(request.expiresAt)}">${expiresIn>0?`noch ${expiresIn} Sekunden gültig`:"abgelaufen"}</span></p>
    ${warnings?`<ul class="small" style="margin:12px 0 0 18px">${warnings}</ul>`:""}
    <div class="actions" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" data-a="clock-approve" data-id="${esc(request.id)}" ${expiresIn>0?"":"disabled"}>Mit Standort bestätigen ${I.check}</button>
      <button class="btn outline" data-a="clock-deny" data-id="${esc(request.id)}">Ablehnen</button>
    </div>
    <p class="access-note">Die Arbeitszeit wird erst nach Bestätigung mit deinem persönlichen Konto gespeichert.</p>
  </section>`;
}

function renderEmployee(){
  const employeeId=S.session?.subjectId||S.session?.employeeId;
  const employee=(S.state?.employees||[]).find(item=>item.id===employeeId);
  if(!employee){
    clearSessions();
    S.session=null;
    S.state=null;
    renderError("Das angemeldete Mitarbeiterkonto wurde nicht gefunden. Bitte erneut anmelden.");
    return;
  }
  const originalState=S.state;
  S.state=employeeScopedState(employee);
  try{
    const view=S.employeeView;
    const unread=(S.state.notifications||[]).filter(note=>note.employeeId===employee.id&&note.read!==true).length;
    app.innerHTML=`<div class="employee-app">
      <header class="employee-header">
        <div class="logo-wrap">${logo}</div>
        <div class="employee-header-actions">
          <button class="circle-btn" aria-label="Benachrichtigungen">${I.bell}${unread?`<b class="badge-count">${unread}</b>`:""}</button>
          ${employeeAvatar(employee)}
          <button class="circle-btn" data-a="logout" aria-label="Abmelden">${I.logout}</button>
        </div>
      </header>
      <main class="employee-main">${clockApprovalPanel(employee)}${employeeView(employee,view)}</main>
      <nav class="employee-bottom" aria-label="Mitarbeiter Navigation">
        ${[["home","Start",I.home],["calendar","Kalender",I.cal],["time","Zeiten",I.clock],["leave","Urlaub",I.umbrella],["more","Mehr",I.menu]].map(([id,label,icon])=>`<button class="${view===id?"active":""}" data-a="employee-view" data-view="${id}">${icon}<span>${label}</span>${id==="more"&&unread?`<b class="badge-count" style="right:16px;top:8px">${unread}</b>`:""}</button>`).join("")}
      </nav>
    </div>`;
  }finally{
    S.state=originalState;
  }
}
