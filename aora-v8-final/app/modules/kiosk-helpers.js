"use strict";
function kcol(title,sub,items,cls,target){
  const emptyIcon=cls==="pause"?"coffee":"person_search";
  return`<section class="kiosk-column ${cls}" data-kiosk-target="${target}">
    <div class="kiosk-column-head"><div><h2>${title}</h2><p>${sub}</p></div><div class="count-box">${items.length}</div></div>
    ${items.length?`<div class="kiosk-list">${items.map(e=>kperson(e,cls)).join("")}</div>`:`<div class="kiosk-empty"><div><span class="material-symbols-rounded">${emptyIcon}</span><strong>${title==="Pause"?"Aktuell niemand in Pause":"Keine Mitarbeiter"}</strong><p>Mitarbeiter können hierher gezogen werden.</p></div></div>`}
  </section>`
}
function kperson(e,status){
  const avatar=e.avatarDataUrl?`<img src="${esc(e.avatarDataUrl)}" alt="">`:esc(e.initials||initials(e.name));
  return`<button class="kiosk-person ${status} ${S.selected===e.id?"selected":""}" data-a="select-person" data-id="${e.id}" draggable="true" aria-pressed="${S.selected===e.id}">
    <div class="avatar">${avatar}<i aria-hidden="true"></i></div>
    <span><strong>${esc(e.name)}</strong><small>${esc(e.role||"Mitarbeiter")}</small></span>
    <span class="material-symbols-rounded drag-handle" aria-hidden="true">drag_indicator</span>
  </button>`
}
function kioskActions(){
  const employee=S.selected?emp(S.selected):null,en=employee?live(employee.id):null;
  const primaryTarget=!en?"in":en.status==="paused"?"in":"pause";
  const primaryLabel=!en?"Arbeitszeit starten":en.status==="paused"?"Pause beenden":"Pause";
  const primaryIcon=!en?"login":en.status==="paused"?"play_arrow":"coffee";
  const avatar=employee?(employee.avatarDataUrl?`<img src="${esc(employee.avatarDataUrl)}" alt="">`:esc(employee.initials||initials(employee.name))):`<span class="material-symbols-rounded">person</span>`;
  return`<section class="kiosk-actionbar" aria-label="Kiosk Aktionen">
    <div class="kiosk-selection ${employee?"has-selection":""}">
      <div class="avatar">${avatar}</div>
      <span><small>${employee?"Ausgewählt":"Mitarbeiter auswählen"}</small><strong>${employee?esc(employee.name):"Tippen oder Namen ziehen"}</strong></span>
      ${employee?`<button class="kiosk-clear" data-a="clear-person" aria-label="Auswahl aufheben"><span class="material-symbols-rounded">close</span></button>`:""}
    </div>
    <button class="kiosk-action" data-a="transition" data-target="${primaryTarget}" ${employee?"":"disabled"}><span class="material-symbols-rounded">${primaryIcon}</span>${primaryLabel}</button>
    <button class="kiosk-action" data-a="transition" data-target="out" ${employee&&en?"":"disabled"}><span class="material-symbols-rounded">logout</span>Feierabend</button>
    <button class="kiosk-action" data-a="kiosk-help"><span class="material-symbols-rounded">help</span>Hilfe</button>
  </section>`
}
