"use strict";

function isActivatedAccount(account){
  return account?.active!==false&&account?.status!=="pending"&&account?.status!=="revoked";
}

function adminStats(){
  const weekStart=startWeek(),weekEnd=addDays(weekStart,6);
  const employees=filteredEmployees().filter(isActivatedAccount);
  const employeeIds=new Set(employees.map(employee=>employee.id));
  const shifts=(S.state.shifts||[]).filter(item=>item.locationId===S.locationId&&employeeIds.has(item.employeeId)&&item.date>=weekStart&&item.date<=weekEnd);
  const entries=(S.state.timeEntries||[]).filter(item=>item.locationId===S.locationId&&employeeIds.has(item.employeeId)&&item.date>=weekStart&&item.date<=weekEnd);
  const planned=shifts.reduce((sum,item)=>sum+mins(item.start,item.end,item.breakMinutes),0);
  const worked=entries.reduce((sum,item)=>sum+(item.end?mins(item.start,item.end,item.breakMinutes):0),0);
  const on=(S.state.timeEntries||[]).filter(item=>item.locationId===S.locationId&&employeeIds.has(item.employeeId)&&["live","paused"].includes(item.status));
  return{employees,shifts,entries,planned,worked,on};
}

function ownerOverviewPage(){
  const locations=activeLocations();
  const managerList=managers().filter(isActivatedAccount);
  const employees=(S.state.employees||[]).filter(isActivatedAccount);
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
      ${adminKpi(I.people,"Mitarbeiter",employees.length,"Aktive Konten")}
      ${adminKpi(I.news,"Offene Einladungen",invitations.length,"Noch nicht aktiviert")}
    </div>
    <div class="owner-grid">
      <article class="dashboard-card owner-wide-card">
        <div class="dashboard-card-head"><h2>Standorte und Zuständigkeit <small>${locations.length} aktiv</small></h2><button class="link-btn" data-a="admin-view" data-view="locations">Alle Läden ${I.arrow}</button></div>
        <div class="owner-location-list">
          ${managerCoverage.map(({location,managers,employees})=>`<button class="owner-location-row" data-a="select-location" data-id="${location.id}">
            <div class="metric-icon">${I.pin}</div>
            <span><strong>${esc(location.name)}</strong><small>${esc(location.city||"")} · ${esc(location.address||"Adresse offen")}</small></span>
            <b>${employees.length} Mitarbeiter</b>
            <em>${managers.length?managers.map(item=>esc(item.name)).join(", "):"Kein aktiver Manager"}</em>
            ${I.arrow}
          </button>`).join("")||'<div class="empty">Noch kein Laden angelegt.</div>'}
        </div>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Offene Einladungen <small>${invitations.length}</small></h2><button class="link-btn" data-a="admin-view" data-view="invitations">Verwalten ${I.arrow}</button></div>
        <div class="dashboard-body">
          ${invitations.slice(0,5).map(invitation=>`<div class="duty-row"><div class="initial-bar">${esc(initials(invitation.name))}</div><div class="row-copy"><strong>${esc(invitation.name)}</strong><small>${esc(invitation.email)} · ${invitation.kind==="manager"?"Manager":"Mitarbeiter"}</small></div><span class="status-chip">Offen</span></div>`).join("")||'<div class="empty">Keine offenen Einladungen.</div>'}
        </div>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Aktive Manager <small>${managerList.length}</small></h2><button class="link-btn" data-a="manager-modal">Manager einladen ${I.arrow}</button></div>
        <div class="dashboard-body">
          ${managerList.slice(0,5).map(manager=>`<div class="duty-row"><div class="initial-bar">${esc(manager.initials||initials(manager.name))}</div><div class="row-copy"><strong>${esc(manager.name)}</strong><small>${(manager.locationIds||[]).map(id=>esc(loc(id)?.name||id)).join(", ")}</small></div><span class="status-chip black">Aktiv</span></div>`).join("")||'<div class="empty">Noch kein aktiver Manager.</div>'}
        </div>
      </article>
    </div>`;
}

function locationsPage(){
  const locations=activeLocations();
  return head("Läden","Standorte anlegen, prüfen und einem Manager zuweisen.",'<button class="btn" data-a="location-modal">Neuen Laden anlegen</button>')
    +`<div class="location-card-grid">${locations.map(location=>{
      const employeeCount=(S.state.employees||[]).filter(employee=>employee.locationId===location.id&&isActivatedAccount(employee)).length;
      const locationManagers=managers().filter(manager=>isActivatedAccount(manager)&&(manager.locationIds||[]).includes(location.id));
      return `<article class="location-card">
        <div class="location-card-top"><div class="metric-icon">${I.pin}</div><span class="status-chip black">Aktiv</span></div>
        <h2>${esc(location.name)}</h2>
        <p>${esc(location.address||"Keine Adresse")}<br>${esc(location.city||"")}</p>
        <dl><div><dt>Mitarbeiter</dt><dd>${employeeCount}</dd></div><div><dt>Manager</dt><dd>${locationManagers.length}</dd></div><div><dt>Kostenstelle</dt><dd>${esc(location.costCenter||"–")}</dd></div></dl>
        <div class="card-actions"><button class="btn outline" data-a="select-location" data-id="${location.id}">Betrieb öffnen</button><button class="btn light" data-a="edit-location" data-id="${location.id}">Bearbeiten</button><button class="circle-btn" data-a="archive-location" data-id="${location.id}" aria-label="Archivieren">${I.x}</button></div>
      </article>`;
    }).join("")||'<div class="empty">Noch kein Laden angelegt.</div>'}</div>`;
}

function reportsPage(ownerMode=false){
  if(ownerMode){
    const locations=activeLocations();
    const planned=(S.state.shifts||[]).reduce((sum,item)=>sum+mins(item.start,item.end,item.breakMinutes),0);
    const worked=(S.state.timeEntries||[]).reduce((sum,item)=>sum+(item.end?mins(item.start,item.end,item.breakMinutes):0),0);
    const activeEmployees=(S.state.employees||[]).filter(isActivatedAccount).length;
    return head("Unternehmensberichte","Standortübergreifende Kennzahlen der isolierten V8-Version.")
      +`<div class="admin-kpis">${adminKpi(I.pin,"Läden",locations.length,"Aktiv")}${adminKpi(I.cal,"Plan",fm(planned),"Gesamt")}${adminKpi(I.clock,"Ist",fm(worked),"Gesamt")}${adminKpi(I.people,"Mitarbeiter",activeEmployees,"Aktive Konten")}</div>`;
  }
  const stats=adminStats();
  return head("Berichte","Wochenübersicht für Planung und Arbeitszeit.")+`<div class="admin-kpis">${adminKpi(I.cal,"Plan",fm(stats.planned),"Diese Woche")}${adminKpi(I.clock,"Ist",fm(stats.worked),"Diese Woche")}${adminKpi(I.chart,"Differenz",fm(stats.worked-stats.planned),"Plan vs. Ist")}${adminKpi(I.people,"Mitarbeiter",stats.employees.length,"Aktiv am Standort")}</div>`;
}
