"use strict";

const managerNav=[
  ["overview","Übersicht",I.grid],
  ["schedule","Dienstplan",I.cal],
  ["time","Zeiterfassung",I.clock],
  ["leave","Abwesenheiten",I.umbrella],
  ["employees","Mitarbeiter",I.people],
  ["reports","Berichte",I.chart],
  ["news","Team-News",I.news],
  ["kiosk","Kiosk",I.monitor],
  ["settings","Einstellungen",I.settings]
];
const ownerNav=[
  ["owner-overview","Inhaber-Übersicht",I.grid],
  ["locations","Läden",I.pin],
  ["managers","Manager",I.people],
  ["invitations","Einladungen",I.news],
  ["operations","Betrieb",I.cal],
  ["reports","Berichte",I.chart],
  ["settings","Einstellungen",I.settings]
];

function currentAdmin(){
  return S.state.admins?.find(item=>item.id===S.session.subjectId)
    ||S.state.admins?.[0]
    ||{name:"Aora Admin",role:"Administrator",initials:"AA"};
}
function isOwner(){return S.accessRole==="owner"}
function activeLocations(){return(S.state.locations||[]).filter(location=>location.active!==false)}
function managers(){return(S.state.admins||[]).filter(admin=>admin.scope==="manager"&&admin.status!=="revoked")}
function pendingInvitations(){return(S.state.invitations||[]).filter(invitation=>invitation.status==="pending")}

function renderAdmin(){
  const admin=currentAdmin();
  const locations=activeLocations();
  if(!S.locationId||!locations.some(location=>location.id===S.locationId))S.locationId=locations[0]?.id||null;
  const location=loc(S.locationId)||locations[0];
  const navigation=isOwner()?ownerNav:managerNav;
  const topAction=isOwner()
    ?'<button class="btn" data-a="location-modal">Neuen Laden anlegen</button>'
    :'<button class="btn" data-a="employee-account-modal">Mitarbeiter anlegen</button>';
  app.innerHTML=`<div class="admin-app">
    <aside class="admin-sidebar" id="aside">
      <div>${logo}</div>
      <div class="company-switch">
        <div class="company-row">
          <div class="metric-icon">${I.news}</div>
          <div><strong>${esc(S.state.company?.name||"AoraAI Workforce")}</strong><small>${isOwner()?"Inhaber-Konto":"Arbeitgeber-Konto"}</small></div>
        </div>
        <select class="location-select" id="loc-select" ${locations.length?"":"disabled"}>
          ${locations.map(item=>`<option value="${item.id}" ${item.id===S.locationId?"selected":""}>${esc(item.name)}</option>`).join("")}
        </select>
      </div>
      <nav class="admin-nav">
        ${navigation.map(([id,label,icon])=>`<button class="${S.adminView===id?"active":""}" data-a="admin-view" data-view="${id}">${icon}<span>${label}</span>${id==="leave"&&pendingLeave().length?`<b class="nav-badge">${pendingLeave().length}</b>`:""}${id==="invitations"&&pendingInvitations().length?`<b class="nav-badge">${pendingInvitations().length}</b>`:""}</button>`).join("")}
      </nav>
      <div class="sidebar-bottom">
        <button class="kiosk-mode" data-a="open-kiosk">${I.monitor}<span><strong>Kiosk-Modus</strong><small>${esc(location?.name||"Kein Laden")} · lokales Gerät</small></span>${I.arrow}</button>
        <div class="admin-user">
          <div class="avatar">${esc(admin.initials||initials(admin.name))}</div>
          <span><strong>${esc(admin.name)}</strong><small>${isOwner()?"Inhaber":esc(admin.role||"Manager")}</small></span>
          <button class="circle-btn" style="border:0;width:32px;height:32px" data-a="logout" aria-label="Abmelden">${I.logout}</button>
        </div>
      </div>
    </aside>
    <main class="admin-main">
      <header class="admin-topbar">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="circle-btn mobile-admin-menu" data-a="admin-menu" aria-label="Menü">${I.menu}</button>
          <div><div class="date">${fd(berlin().date,{weekday:true,long:true})}</div><h1>${adminTitle()}${location&&["operations","overview","schedule","time","leave","employees","news","kiosk"].includes(S.adminView)?` · ${esc(location.name)}`:""}</h1></div>
        </div>
        <div class="admin-top-actions">${topAction}<button class="circle-btn" aria-label="Benachrichtigungen">${I.bell}${pendingInvitations().length?`<b class="badge-count">${pendingInvitations().length}</b>`:""}</button></div>
      </header>
      <section class="admin-content">${adminView()}</section>
    </main>
  </div>`;
  document.getElementById("loc-select")?.addEventListener("change",event=>{
    S.locationId=event.target.value;
    renderAdmin();
  });
}
function adminTitle(){
  return({
    "owner-overview":"Inhaber-Übersicht",locations:"Läden",managers:"Manager",invitations:"Einladungen",operations:"Betrieb",
    overview:"Übersicht",schedule:"Dienstplan",time:"Zeiterfassung",leave:"Abwesenheiten",employees:"Mitarbeiter",
    reports:"Berichte",news:"Team-News",kiosk:"Kiosk",settings:"Einstellungen"
  })[S.adminView]||"Übersicht";
}
function adminView(){
  if(isOwner()){
    if(S.adminView==="locations")return locationsPage();
    if(S.adminView==="managers")return managersPage();
    if(S.adminView==="invitations")return invitationsPage();
    if(S.adminView==="operations")return overviewPage();
    if(S.adminView==="reports")return reportsPage(true);
    if(S.adminView==="settings")return settingsPage();
    return ownerOverviewPage();
  }
  if(S.adminView==="schedule")return schedulePage();
  if(S.adminView==="time")return timePage();
  if(S.adminView==="leave")return leavePage();
  if(S.adminView==="employees")return employeesPage();
  if(S.adminView==="reports")return reportsPage();
  if(S.adminView==="news")return newsPage();
  if(S.adminView==="kiosk")return kioskAdminPage();
  if(S.adminView==="settings")return settingsPage();
  return overviewPage();
}

function ownerOverviewPage(){
  const locations=activeLocations();
  const managerList=managers().filter(item=>item.active!==false);
  const employees=(S.state.employees||[]).filter(item=>item.active!==false);
  const invitations=pendingInvitations();
  const managerCoverage=locations.map(location=>({
    location,
    managers:managerList.filter(manager=>(manager.locationIds||[]).includes(location.id)),
    employees:employees.filter(employee=>employee.locationId===location.id)
  }));
  return `<div class="owner-hero">
      <div><div class="caps">AoraAI Inhaber</div><h1>Dein Unternehmen auf einen Blick.</h1><p>Lege Läden an, gib Managern gezielten Zugriff und kontrolliere, wer für welchen Standort arbeitet.</p></div>
      <button class="btn owner-hero-action" data-a="location-modal">Neuen Laden anlegen ${I.arrow}</button>
    </div>
    <div class="admin-kpis">
      ${adminKpi(I.pin,"Aktive Läden",locations.length,"Unternehmensweit")}
      ${adminKpi(I.people,"Manager",managerList.length,"Aktive Zugänge")}
      ${adminKpi(I.people,"Mitarbeiter",employees.length,"Alle Standorte")}
      ${adminKpi(I.news,"Offene Einladungen",invitations.length,"E-Mail-Zugänge")}
    </div>
    <div class="owner-grid">
      <article class="dashboard-card owner-wide-card">
        <div class="dashboard-card-head"><h2>Standorte und Zuständigkeit <small>${locations.length} aktiv</small></h2><button class="link-btn" data-a="admin-view" data-view="locations">Alle Läden ${I.arrow}</button></div>
        <div class="owner-location-list">
          ${managerCoverage.map(({location,managers,employees})=>`<button class="owner-location-row" data-a="select-location" data-id="${location.id}">
            <div class="metric-icon">${I.pin}</div>
            <span><strong>${esc(location.name)}</strong><small>${esc(location.city||"")} · ${esc(location.address||"Adresse offen")}</small></span>
            <b>${employees.length} Mitarbeiter</b>
            <em>${managers.length?managers.map(item=>esc(item.name)).join(", "):"Kein Manager"}</em>
            ${I.arrow}
          </button>`).join("")||'<div class="empty">Noch kein Laden angelegt.</div>'}
        </div>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Offene Einladungen <small>${invitations.length}</small></h2><button class="link-btn" data-a="admin-view" data-view="invitations">Verwalten ${I.arrow}</button></div>
        <div class="dashboard-body">
          ${invitations.slice(0,5).map(invitation=>`<div class="duty-row"><div class="initial-bar">${esc(initials(invitation.name))}</div><div class="row-copy"><strong>${esc(invitation.name)}</strong><small>${esc(invitation.email)} · ${invitation.kind==="manager"?"Manager":"Mitarbeiter"}</small></div><span class="status-chip">${invitation.emailStatus==="sent"?"Versendet":invitation.emailStatus==="failed"?"Fehler":"Offen"}</span></div>`).join("")||'<div class="empty">Keine offenen Einladungen.</div>'}
        </div>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Manager-Zugänge <small>${managerList.length}</small></h2><button class="link-btn" data-a="manager-modal">Manager einladen ${I.arrow}</button></div>
        <div class="dashboard-body">
          ${managerList.slice(0,5).map(manager=>`<div class="duty-row"><div class="initial-bar">${esc(manager.initials||initials(manager.name))}</div><div class="row-copy"><strong>${esc(manager.name)}</strong><small>${(manager.locationIds||[]).map(id=>esc(loc(id)?.name||id)).join(", ")}</small></div><span class="status-chip ${manager.status==="active"?"black":""}">${manager.status==="active"?"Aktiv":"Eingeladen"}</span></div>`).join("")||'<div class="empty">Noch kein Manager eingeladen.</div>'}
        </div>
      </article>
    </div>`;
}

function locationsPage(){
  const locations=activeLocations();
  return head("Läden","Standorte anlegen, prüfen und einem Manager zuweisen.",'<button class="btn" data-a="location-modal">Neuen Laden anlegen</button>')
    +`<div class="location-card-grid">${locations.map(location=>{
      const employeeCount=S.state.employees.filter(employee=>employee.locationId===location.id&&employee.active!==false).length;
      const locationManagers=managers().filter(manager=>(manager.locationIds||[]).includes(location.id));
      return `<article class="location-card">
        <div class="location-card-top"><div class="metric-icon">${I.pin}</div><span class="status-chip black">Aktiv</span></div>
        <h2>${esc(location.name)}</h2>
        <p>${esc(location.address||"Keine Adresse")}<br>${esc(location.city||"")}</p>
        <dl><div><dt>Mitarbeiter</dt><dd>${employeeCount}</dd></div><div><dt>Manager</dt><dd>${locationManagers.length}</dd></div><div><dt>Kostenstelle</dt><dd>${esc(location.costCenter||"–")}</dd></div></dl>
        <div class="card-actions"><button class="btn outline" data-a="select-location" data-id="${location.id}">Betrieb öffnen</button><button class="btn light" data-a="edit-location" data-id="${location.id}">Bearbeiten</button><button class="circle-btn" data-a="archive-location" data-id="${location.id}" aria-label="Archivieren">${I.x}</button></div>
      </article>`;
    }).join("")||'<div class="empty">Noch kein Laden angelegt.</div>'}</div>`;
}

function managersPage(){
  const rows=managers();
  return head("Manager","Manager per E-Mail einladen und exakt den richtigen Läden zuordnen.",'<button class="btn" data-a="manager-modal">Manager einladen</button>')
    +`<div class="manager-card-grid">${rows.map(manager=>`<article class="manager-card">
      <div class="manager-card-head"><div class="avatar">${esc(manager.initials||initials(manager.name))}</div><span class="status-chip ${manager.status==="active"?"black":""}">${manager.status==="active"?"Aktiv":"Eingeladen"}</span></div>
      <h2>${esc(manager.name)}</h2><p>${esc(manager.email||"E-Mail offen")}</p>
      <div class="manager-location-chips">${(manager.locationIds||[]).map(id=>`<span>${esc(loc(id)?.name||id)}</span>`).join("")||"<span>Kein Laden</span>"}</div>
      <div class="card-actions"><button class="btn outline" data-a="manager-access-modal" data-id="${manager.id}">Läden zuweisen</button><button class="btn light" data-a="deactivate-manager" data-id="${manager.id}">Deaktivieren</button></div>
    </article>`).join("")||'<div class="empty">Noch kein Manager angelegt.</div>'}</div>`;
}

function invitationsPage(){
  const rows=S.state.invitations||[];
  return head("Einladungen","E-Mail-Zugänge verfolgen, erneut senden oder widerrufen.")
    +`<div class="invitation-list">${rows.map(invitation=>`<article class="invitation-row">
      <div class="avatar">${esc(initials(invitation.name))}</div>
      <div class="row-copy"><strong>${esc(invitation.name)}</strong><small>${esc(invitation.email)} · ${invitation.kind==="manager"?"Manager":"Mitarbeiter"} · ${invitationLocationNames(invitation)}</small></div>
      <span class="status-chip ${invitation.status==="accepted"?"black":""}">${invitation.status==="accepted"?"Aktiv":invitation.status==="revoked"?"Widerrufen":invitation.emailStatus==="failed"?"E-Mail-Fehler":"Offen"}</span>
      ${invitation.status==="pending"?`<div class="invite-actions"><button class="btn outline" data-a="resend-invitation" data-id="${invitation.id}">Erneut senden</button><button class="btn light" data-a="revoke-invitation" data-id="${invitation.id}">Widerrufen</button></div>`:""}
    </article>`).join("")||'<div class="empty">Keine Einladungen vorhanden.</div>'}</div>`;
}
function invitationLocationNames(invitation){
  return(invitation.locationIds||[invitation.locationId]).filter(Boolean).map(id=>loc(id)?.name||id).join(", ")||"Unternehmen";
}

function filteredEmployees(){return(S.state.employees||[]).filter(item=>item.active!==false&&item.locationId===S.locationId)}
function todayShifts(){
  const date=berlin().date;
  return(S.state.shifts||[]).filter(item=>item.locationId===S.locationId&&item.date===date).sort((a,b)=>a.start.localeCompare(b.start));
}
function pendingLeave(){
  return(S.state.leaveRequests||[]).filter(item=>item.status==="pending"&&emp(item.employeeId)?.locationId===S.locationId);
}
function adminStats(){
  const weekStart=startWeek(),weekEnd=addDays(weekStart,6),employees=filteredEmployees();
  const shifts=S.state.shifts.filter(item=>item.locationId===S.locationId&&item.date>=weekStart&&item.date<=weekEnd);
  const entries=S.state.timeEntries.filter(item=>item.locationId===S.locationId&&item.date>=weekStart&&item.date<=weekEnd);
  const planned=shifts.reduce((sum,item)=>sum+mins(item.start,item.end,item.breakMinutes),0);
  const worked=entries.reduce((sum,item)=>sum+(item.end?mins(item.start,item.end,item.breakMinutes):0),0);
  const on=S.state.timeEntries.filter(item=>item.locationId===S.locationId&&["live","paused"].includes(item.status));
  return{employees,shifts,entries,planned,worked,on};
}
function overviewPage(){
  if(!S.locationId)return'<div class="empty">Bitte zuerst einen Laden anlegen.</div>';
  const stats=adminStats(),today=todayShifts(),leave=pendingLeave();
  return`${isOwner()?`<div class="section-context"><span>Inhaberansicht</span><strong>${esc(loc(S.locationId)?.name||"")}</strong><button class="link-btn" data-a="admin-view" data-view="owner-overview">Zur Unternehmensübersicht ${I.arrow}</button></div>`:""}
    <div class="admin-kpis">
      ${adminKpi(I.people,"Jetzt im Dienst",stats.on.filter(item=>item.status==="live").length,`${today.length} heute geplant`)}
      ${adminKpi(I.cal,"Geplante Stunden",fm(stats.planned),"Diese Woche")}
      ${adminKpi(I.clock,"Erfasste Stunden",fm(stats.worked),"Diese Woche")}
      ${adminKpi(I.umbrella,"Offene Anträge",leave.length,"Benötigen Entscheidung")}
    </div>
    <div class="admin-dashboard">
      <article class="dashboard-card"><div class="dashboard-card-head"><h2>Jetzt im Dienst <small>${stats.on.length} aktiv</small></h2><button class="link-btn" data-a="open-kiosk">Kiosk öffnen ${I.arrow}</button></div><div class="dashboard-body">${stats.on.map(item=>{const employee=emp(item.employeeId);return`<div class="duty-row"><div class="initial-bar">${esc(employee?.initials||initials(employee?.name))}</div><div class="row-copy"><strong>${esc(employee?.name)}</strong><small>${esc(employee?.role)} · seit ${item.start}</small></div><span class="row-status"><span class="dot" style="display:inline-block;margin-right:4px"></span>${item.status==="paused"?"Pause":fm(mins(item.start,berlin().time,item.breakMinutes))}</span></div>`}).join("")||'<div class="empty">Aktuell niemand im Dienst.</div>'}</div></article>
      <article class="dashboard-card"><div class="dashboard-card-head"><h2>Heutiger Dienstplan <small>${today.length} Schichten</small></h2><button class="link-btn" data-a="admin-view" data-view="schedule">Plan bearbeiten ${I.arrow}</button></div><div class="dashboard-body">${today.map(item=>{const employee=emp(item.employeeId),active=!!live(employee?.id);return`<div class="schedule-row"><div style="width:40px;font-size:10px;font-weight:700">${item.start}<small style="display:block;color:#999;font-size:7px">${item.end}</small></div><div class="initial-bar" style="min-width:42px">${esc(employee?.initials||initials(employee?.name))}</div><div class="row-copy"><strong>${esc(employee?.name)}</strong><small>${esc(employee?.role)} · ${fm(mins(item.start,item.end,item.breakMinutes))}</small></div><span class="status-chip ${active?"black":""}">${active?"Anwesend":"Geplant"}</span></div>`}).join("")||'<div class="empty">Keine Schichten heute.</div>'}</div></article>
      <article class="dashboard-card"><div class="dashboard-card-head"><h2>Offene Urlaubsanträge <small>${leave.length} offen</small></h2><button class="link-btn" data-a="admin-view" data-view="leave">Alle anzeigen ${I.arrow}</button></div><div class="dashboard-body">${leave.map(leaveDashboardRow).join("")||'<div class="empty">Keine offenen Anträge.</div>'}</div></article>
      <article class="dashboard-card"><div class="dashboard-card-head"><h2>Stunden dieser Woche <small>Plan vs. Ist</small></h2><button class="link-btn" data-a="admin-view" data-view="reports">Bericht öffnen ${I.arrow}</button></div><div class="dashboard-body">${stats.employees.slice(0,5).map(employee=>{const stat=employeeStats(employee),percentage=Math.min(100,stat.planned?stat.worked/stat.planned*100:0);return`<div class="hours-row"><div class="row-copy"><strong>${esc(employee.name)}</strong><small>${fm(stat.worked)} / ${fm(stat.planned)}</small></div><div class="progress"><span style="width:${percentage}%"></span></div><b class="tiny">${fm(stat.balance)}</b></div>`}).join("")}</div></article>
    </div>`;
}
function adminKpi(icon,label,value,subtitle){
  return`<div class="admin-kpi"><div class="metric-icon">${icon}</div><div><label>${label}</label><strong>${value}</strong><small>${subtitle}</small></div></div>`;
}
function leaveDashboardRow(request){
  const employee=emp(request.employeeId);
  return`<div class="leave-row"><div class="initial-bar">${esc(employee?.initials||initials(employee?.name))}</div><div class="row-copy"><strong>${esc(employee?.name)}</strong><small>${request.start}–${request.end} · ${request.days||0} Arbeitstage</small></div><div class="leave-actions"><button class="accept" data-a="leave-decision" data-id="${request.id}" data-decision="approved">${I.check}</button><button data-a="leave-decision" data-id="${request.id}" data-decision="rejected">${I.x}</button></div></div>`;
}
function head(title,subtitle,button=""){
  return`<div class="admin-page-head"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`;
}
function schedulePage(){
  const rows=S.state.shifts.filter(item=>item.locationId===S.locationId).sort((a,b)=>`${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  return head("Dienstplan","Schichten planen und veröffentlichen.",'<button class="btn" data-a="shift-modal">Neue Schicht</button>')+table(["Datum","Mitarbeiter","Zeit","Pause","Status"],rows.map(item=>[fd(item.date,{weekday:true}),emp(item.employeeId)?.name,`${item.start}–${item.end}`,`${item.breakMinutes||0} Min.`,item.status]));
}
function timePage(){
  const rows=S.state.timeEntries.filter(item=>item.locationId===S.locationId).sort((a,b)=>`${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));
  return head("Zeiterfassung","Erfasste Arbeitszeiten am Standort.")+table(["Datum","Mitarbeiter","Beginn","Ende","Pause","Status"],rows.map(item=>[fd(item.date,{weekday:true}),emp(item.employeeId)?.name,item.start,item.end||"läuft",`${item.breakMinutes||0} Min.`,item.status]));
}
function leavePage(){
  const rows=S.state.leaveRequests.filter(item=>emp(item.employeeId)?.locationId===S.locationId);
  return head("Abwesenheiten","Urlaub und sonstige Abwesenheiten entscheiden.")+`<div class="panel" style="padding:15px">${rows.map(item=>item.status==="pending"?leaveDashboardRow(item):`<div class="leave-row"><div class="initial-bar">${esc(emp(item.employeeId)?.initials)}</div><div class="row-copy"><strong>${esc(emp(item.employeeId)?.name)}</strong><small>${item.start}–${item.end} · ${item.days||0} Tage</small></div><span class="pill">${esc(item.status)}</span></div>`).join("")||'<div class="empty">Keine Anträge.</div>'}</div>`;
}
function employeesPage(){
  const rows=filteredEmployees();
  return head("Mitarbeiter","Konten, Rollen und Urlaubskonten dieses Ladens.",'<button class="btn" data-a="employee-account-modal">Mitarbeiter anlegen</button>')
    +`<div class="employee-admin-list">${rows.map(employee=>`<article class="employee-admin-row"><div class="avatar">${esc(employee.initials||initials(employee.name))}</div><div class="row-copy"><strong>${esc(employee.name)}</strong><small>${esc(employee.email||"Keine E-Mail")} · ${esc(employee.role||"Mitarbeiter")}</small></div><span class="status-chip ${employee.status==="active"?"black":""}">${employee.status==="pending"?"Eingeladen":employee.status==="revoked"?"Deaktiviert":"Aktiv"}</span><b>${employee.weeklyTarget||0} h/Woche</b><button class="btn light" data-a="deactivate-employee" data-id="${employee.id}">Deaktivieren</button></article>`).join("")||'<div class="empty">Keine Mitarbeiter an diesem Laden.</div>'}</div>`;
}
function reportsPage(ownerMode=false){
  if(ownerMode){
    const locations=activeLocations();
    const planned=S.state.shifts.reduce((sum,item)=>sum+mins(item.start,item.end,item.breakMinutes),0);
    const worked=S.state.timeEntries.reduce((sum,item)=>sum+(item.end?mins(item.start,item.end,item.breakMinutes):0),0);
    return head("Unternehmensberichte","Standortübergreifende Kennzahlen der isolierten V8-Version.")
      +`<div class="admin-kpis">${adminKpi(I.pin,"Läden",locations.length,"Aktiv")}${adminKpi(I.cal,"Plan",fm(planned),"Gesamt")}${adminKpi(I.clock,"Ist",fm(worked),"Gesamt")}${adminKpi(I.people,"Mitarbeiter",S.state.employees.filter(item=>item.active!==false).length,"Aktiv")}</div>`;
  }
  const stats=adminStats();
  return head("Berichte","Wochenübersicht für Planung und Arbeitszeit.")+`<div class="admin-kpis">${adminKpi(I.cal,"Plan",fm(stats.planned),"Diese Woche")}${adminKpi(I.clock,"Ist",fm(stats.worked),"Diese Woche")}${adminKpi(I.chart,"Differenz",fm(stats.worked-stats.planned),"Plan vs. Ist")}${adminKpi(I.people,"Mitarbeiter",stats.employees.length,"Aktiv am Standort")}</div>`;
}
function newsPage(){
  return head("Team-News","Mitteilungen für dein Team.",'<button class="btn" data-a="news-modal">Mitteilung erstellen</button>')+`<div class="admin-dashboard">${S.state.announcements.filter(item=>item.audience==="all"||item.audience===S.locationId).map(item=>`<article class="dashboard-card" style="min-height:180px;padding:20px"><div class="caps muted">${item.audience==="all"?"Alle":loc(item.audience)?.name||item.audience}</div><h2 style="margin-top:10px">${esc(item.title)}</h2><p class="small muted" style="margin-top:10px;line-height:1.6">${esc(item.body)}</p></article>`).join("")||'<div class="empty">Keine Mitteilungen.</div>'}</div>`;
}
function kioskAdminPage(){
  const devices=S.state.kioskDevices.filter(item=>item.locationId===S.locationId);
  return head("Kiosk","Lokale Check-in-Geräte verwalten.",'<button class="btn" data-a="open-kiosk">Kiosk öffnen</button>')+`<div class="admin-dashboard">${devices.map(device=>`<article class="dashboard-card" style="min-height:200px;padding:20px"><div class="caps muted">Gerät</div><h2 style="margin-top:10px">${esc(device.name)}</h2><p class="small muted" style="margin-top:8px">${device.locked?"Gesperrt":"Aktiv"} · Version ${device.activationVersion||1}</p><button class="btn ${device.locked?"":"outline"}" style="margin-top:25px" data-a="toggle-kiosk" data-id="${device.id}">${device.locked?"Entsperren":"Sperren"}</button></article>`).join("")||'<div class="empty">Kein Kiosk-Gerät vorhanden.</div>'}</div>`;
}
function settingsPage(){
  const admin=currentAdmin();
  return head("Einstellungen","Unternehmen, Konto und Arbeitszeitregeln.")
    +`<div class="panel settings-panel"><div class="form-grid">
      <div class="field"><label>Unternehmen</label><input class="input" value="${esc(S.state.company?.name||"")}" disabled></div>
      <div class="field"><label>Kontotyp</label><input class="input" value="${isOwner()?"Inhaber":"Arbeitgeber / Manager"}" disabled></div>
      <div class="field"><label>Angemeldet als</label><input class="input" value="${esc(admin.name)}" disabled></div>
      <div class="field"><label>Zeitzone</label><input class="input" value="${esc(S.state.company?.timezone||CFG.tz)}" disabled></div>
      <div class="field"><label>Max. tägliche Minuten</label><input class="input" value="${S.state.settings?.maxDailyMinutes||600}" disabled></div>
      <div class="field"><label>Pflichtpause</label><input class="input" value="${S.state.settings?.requiredBreakMinutes||30} Minuten" disabled></div>
    </div><div class="isolation-note"><strong>Isolierte Version 8</strong><span>Dieser Arbeitsbereich schreibt ausschließlich in <code>${CFG.slug}</code> und verändert die aktuelle Production-Version nicht.</span></div></div>`;
}
function table(columns,rows){
  return`<div style="overflow:auto;border-radius:16px"><table class="data-table"><thead><tr>${columns.map(column=>`<th>${esc(column)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value??"–")}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="${columns.length}"><div class="empty">Keine Daten.</div></td></tr>`}</tbody></table></div>`;
}
