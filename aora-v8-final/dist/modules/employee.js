"use strict";

function employeeAvatar(employee,className="avatar"){
  const image=employee?.avatarDataUrl
    ?`<img src="${esc(employee.avatarDataUrl)}" alt="${esc(employee.name||"Profilbild")}">`
    :esc(employee?.initials||initials(employee?.name));
  return `<div class="${className}">${image}</div>`;
}

function renderEmployee(){
  const employee=S.state.employees[0]||emp(S.session.subjectId);
  const view=S.employeeView;
  app.innerHTML=`<div class="employee-app">
    <header class="employee-header">
      <div class="logo-wrap">${logo}</div>
      <div class="employee-header-actions">
        <button class="circle-btn" aria-label="Benachrichtigungen">${I.bell}<b class="badge-count">3</b></button>
        ${employeeAvatar(employee)}
        <button class="circle-btn" data-a="logout" aria-label="Abmelden">${I.logout}</button>
      </div>
    </header>
    <main class="employee-main">${employeeView(employee,view)}</main>
    <nav class="employee-bottom" aria-label="Mitarbeiter Navigation">
      ${[["home","Start",I.home],["calendar","Kalender",I.cal],["time","Zeiten",I.clock],["leave","Urlaub",I.umbrella],["more","Mehr",I.menu]].map(([id,label,icon])=>`<button class="${view===id?"active":""}" data-a="employee-view" data-view="${id}">${icon}<span>${label}</span>${id==="more"?'<b class="badge-count" style="right:16px;top:8px">3</b>':""}</button>`).join("")}
    </nav>
  </div>`;
}

function employeeView(employee,view){
  const stats=employeeStats(employee);
  const now=berlin();
  const today=S.state.shifts.find((shift)=>shift.employeeId===employee.id&&shift.date===now.date&&shift.status==="published");
  const entry=live(employee.id);
  const notes=S.state.notifications.filter((note)=>note.employeeId===employee.id);

  if(view==="calendar"){
    return pageList("Dein Dienstplan",stats.shifts.sort((a,b)=>`${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)).map((shift)=>`<div class="mobile-row"><div><strong>${fd(shift.date,{weekday:true})}</strong><small>${esc(loc(shift.locationId)?.name||"")} · ${shift.start}–${shift.end}</small></div><span class="pill">${shift.status==="published"?"Veröffentlicht":"Entwurf"}</span></div>`).join(""));
  }

  if(view==="time"){
    return pageList("Deine Zeiten",`<div class="employee-metrics" style="margin:0 0 14px">
      <div class="employee-metric"><div class="metric-icon">${I.clock}</div><div><label>Diese Woche</label><strong>${fm(stats.worked)}</strong></div></div>
      <div class="employee-metric"><div class="metric-icon">${I.chart}</div><div><label>Stundenkonto</label><strong>${fm(stats.balance)}</strong></div></div>
    </div>${stats.entries.map((item)=>`<div class="mobile-row"><div><strong>${fd(item.date,{weekday:true})}</strong><small>${item.start}–${item.end||"läuft"} · ${item.breakMinutes||0} Min. Pause</small></div><span class="pill">${item.status}</span></div>`).join("")}`);
  }

  if(view==="leave"){
    return `<div class="employee-page-title"><div><div class="caps muted">Abwesenheiten</div><h1>Urlaub</h1></div><button class="btn" data-a="leave-modal">Antrag stellen</button></div>
      <div class="employee-metrics" style="margin:0 0 14px">
        <div class="employee-metric"><div class="metric-icon">${I.umbrella}</div><div><label>Resturlaub</label><strong>${stats.remaining} Tage</strong></div></div>
        <div class="employee-metric"><div class="metric-icon">${I.cal}</div><div><label>Anspruch</label><strong>${employee.vacationAllowance||0} Tage</strong></div></div>
      </div>
      <div class="mobile-list">${S.state.leaveRequests.map((request)=>`<div class="mobile-row"><div><strong>${request.type||"Urlaub"}</strong><small>${request.start} – ${request.end} · ${request.days||0} Tage</small></div><span class="pill">${request.status}</span></div>`).join("")||'<div class="empty">Keine Anträge.</div>'}</div>`;
  }

  if(view==="more"){
    const profile=`<section class="profile-summary">
      ${employeeAvatar(employee,"profile-avatar")}
      <div><div class="caps muted">Dein Konto</div><h2>${esc(employee.name)}</h2><p>${esc(employee.role||"Mitarbeiter")} · ${esc(loc(employee.locationId)?.name||"")}</p></div>
      <button class="btn outline" data-a="profile-modal">Profil bearbeiten</button>
    </section>`;
    const notifications=notes.map((note)=>`<div class="mobile-row"><div><strong>${esc(note.title)}</strong><small>${esc(note.body)}</small></div>${note.read?"":'<span class="dot"></span>'}</div>`).join("");
    return pageList("Mehr",`${profile}${notifications}<button class="btn outline" style="width:100%;margin-top:14px" data-a="logout">Abmelden</button>`);
  }

  return `<section class="employee-view">
    <div class="employee-heading">
      <div class="date">${fd(now.date,{weekday:true,long:true}).toUpperCase()}</div>
      <h1>Guten Morgen, ${esc(employee.name.split(" ")[0])}.</h1>
      <p>Alles Wichtige für deinen Arbeitstag – klar und aktuell.</p>
    </div>
    <article class="employee-hero">
      <div class="employee-hero-top">
        <span class="pill"><span class="dot"></span>${entry?entry.status==="paused"?"In Pause":"Eingestempelt":"Nicht eingestempelt"}</span>
        <span class="location">${I.pin}${esc(loc(employee.locationId)?.name||"Tacheles")}</span>
      </div>
      <div class="employee-shift">
        <div class="caps">Heutige Schicht</div>
        <h2>${today?`${today.start} – ${today.end}`:"Heute frei"}</h2>
        <p>${today?`${esc(employee.role)} · ${fm(mins(today.start,today.end,today.breakMinutes))}`:"Keine veröffentlichte Schicht"}</p>
      </div>
      <button class="checkin-button" data-a="open-kiosk"><span style="display:flex;align-items:center;gap:10px">${I.monitor} AoraAI Check-in öffnen</span>${I.arrow}</button>
    </article>
    <div class="employee-metrics">
      ${metric(I.cal,"Geplant",fm(stats.planned),"Diese Woche")}
      ${metric(I.clock,"Gearbeitet",fm(stats.worked),"Diese Woche")}
      ${metric(I.chart,"Stundenkonto",fm(stats.balance),"gegen Plan bis heute")}
      ${metric(I.umbrella,"Resturlaub",`${stats.remaining} Tage`,`${employee.vacationAllowance||0} Anspruch`)}
    </div>
    <article class="week-card">
      <div class="week-head"><div><div class="caps muted">Fortschritt</div><h3>Deine Woche</h3></div><button data-a="employee-view" data-view="time">Details ${I.arrow}</button></div>
      <div class="week-body"><div class="week-value">${fm(stats.worked)} <small>von ${fm(stats.planned)}</small></div><div class="progress" style="margin-top:13px"><span style="width:${Math.min(100,stats.planned?stats.worked/stats.planned*100:0)}%"></span></div></div>
    </article>
  </section>`;
}

function metric(icon,label,value,subtitle){
  return `<div class="employee-metric"><div class="metric-icon">${icon}</div><div><label>${label}</label><strong>${value}</strong><small>${subtitle}</small></div></div>`;
}

function pageList(title,rows){
  return `<div class="employee-page-title"><div><div class="caps muted">AoraAI</div><h1>${title}</h1></div></div><div class="mobile-list">${rows||'<div class="empty">Keine Einträge.</div>'}</div>`;
}
