"use strict";

function renderEmployee(){
  const employee=emp(S.session.subjectId)||S.state.employees?.find(item=>item.id===S.session.employeeId)||S.state.employees?.[0];
  if(!employee){
    renderError("Das Mitarbeiterkonto wurde nicht gefunden.");
    return;
  }
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
    <main class="employee-main">${employeeView(employee,view)}</main>
    <nav class="employee-bottom" aria-label="Mitarbeiter Navigation">
      ${[["home","Start",I.home],["calendar","Kalender",I.cal],["time","Zeiten",I.clock],["leave","Urlaub",I.umbrella],["more","Mehr",I.menu]].map(([id,label,icon])=>`<button class="${view===id?"active":""}" data-a="employee-view" data-view="${id}">${icon}<span>${label}</span>${id==="more"&&unread?`<b class="badge-count" style="right:16px;top:8px">${unread}</b>`:""}</button>`).join("")}
    </nav>
  </div>`;
}
