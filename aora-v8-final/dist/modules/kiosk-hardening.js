"use strict";

function renderKiosk(){
  const now=berlin();
  const weekday=new Intl.DateTimeFormat("de-DE",{timeZone:CFG.tz,weekday:"long"}).format(new Date(`${berlin().date}T12:00:00`));
  const employees=(S.state.employees||[]).filter(employee=>
    employee.active!==false&&
    employee.status!=="pending"&&
    employee.status!=="revoked"&&
    (!S.session.locationId||employee.locationId===S.session.locationId)
  );
  const out=employees.filter(employee=>!live(employee.id));
  const on=employees.filter(employee=>live(employee.id)?.status==="live");
  const pause=employees.filter(employee=>live(employee.id)?.status==="paused");

  app.innerHTML=`<div class="kiosk-app"><div class="kiosk-surface">
    <header class="kiosk-header">
      <div class="kiosk-brand">${workforceLogo}</div>
      <div class="kiosk-title"><h1>Kiosk</h1><p>Wählen Sie einen Namen aus, um die Arbeitszeit zu erfassen.</p></div>
      <div class="kiosk-clock-card"><span class="material-symbols-rounded" aria-hidden="true">calendar_month</span><div><small>${weekday}</small><strong>${fd(now.date,{long:true})}</strong></div><time data-clock>${now.time}</time></div>
    </header>
    <main class="kiosk-main"><div class="kiosk-columns">
      ${kcol("Ausgestempelt","Heute noch nicht gestartet",out,"out","out")}
      ${kcol("Eingestempelt","Arbeitszeit läuft",on,"active","in")}
      ${kcol("Pause","Pause läuft",pause,"pause","pause")}
    </div>${kioskActions()}</main>
    <footer class="kiosk-footer"><div class="kiosk-footer-meta"><span>${esc(loc(S.session.locationId)?.name||"Tacheles")}</span><span>AoraAI Workforce Kiosk</span></div><div class="kiosk-footer-actions"><button data-a="logout">Sitzung beenden</button><button data-a="switch-admin">Admin</button></div></footer>
  </div></div>`;
  bindKioskDragAndDrop();
}
