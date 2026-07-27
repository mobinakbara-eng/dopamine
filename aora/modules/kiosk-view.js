"use strict";
function renderKiosk(){
  const now=berlin(),weekday=new Intl.DateTimeFormat("de-DE",{timeZone:CFG.tz,weekday:"long"}).format(new Date(`${berlin().date}T12:00:00`)),es=S.state.employees.filter(x=>x.active&&(!S.session.locationId||x.locationId===S.session.locationId));
  const out=es.filter(x=>!live(x.id)),on=es.filter(x=>live(x.id)?.status==="live"),pause=es.filter(x=>live(x.id)?.status==="paused");
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

function bindKioskDragAndDrop(){
  document.querySelectorAll(".kiosk-person[draggable]").forEach(card=>card.addEventListener("dragstart",event=>{
    S.draggedEmployeeId=card.dataset.id;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed="move";
    event.dataTransfer.setData("text/plain",card.dataset.id);
  }));
  document.querySelectorAll(".kiosk-person[draggable]").forEach(card=>card.addEventListener("dragend",()=>{
    card.classList.remove("dragging");
    document.querySelectorAll(".kiosk-column").forEach(column=>column.classList.remove("drag-over"));
  }));
  document.querySelectorAll("[data-kiosk-target]").forEach(column=>{
    column.addEventListener("dragover",event=>{event.preventDefault();column.classList.add("drag-over")});
    column.addEventListener("dragleave",event=>{if(!column.contains(event.relatedTarget))column.classList.remove("drag-over")});
    column.addEventListener("drop",async event=>{
      event.preventDefault();
      const employeeId=event.dataTransfer.getData("text/plain")||S.draggedEmployeeId;
      column.classList.remove("drag-over");
      if(!employeeId)return;
      try{await apply({type:"KIOSK_TRANSITION",employeeId,target:column.dataset.kioskTarget});S.selected=null;renderKiosk()}catch{}
    });
  });
}
