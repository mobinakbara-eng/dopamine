"use strict";
function modal(html){const b=document.createElement("div");b.className="modal-backdrop";b.innerHTML=`<section class="modal">${html}</section>`;document.body.appendChild(b);b.addEventListener("click",e=>{if(e.target===b||e.target.closest('[data-a="close"]'))b.remove()});return b}function leaveModal(){const b=modal(`<div class="modal-head"><div><div class="caps muted">Urlaub</div><h2>Antrag stellen</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div><form id="leave-form" class="form-grid"><div class="field"><label>Von</label><input class="input" type="date" name="start" required></div><div class="field"><label>Bis</label><input class="input" type="date" name="end" required></div><div class="field full"><label>Art</label><select class="select" name="type"><option>Urlaub</option><option>Krankheit</option><option>Unbezahlt</option></select></div><div class="field full"><label>Notiz</label><textarea class="textarea" name="note"></textarea></div><div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Senden</button></div></form>`);b.querySelector("form").addEventListener("submit",async e=>{e.preventDefault();const request=Object.fromEntries(new FormData(e.currentTarget));try{await apply({type:"REQUEST_LEAVE",request});b.remove()}catch{}})}function shiftModal(){const b=modal(`<div class="modal-head"><div><div class="caps muted">Dienstplan</div><h2>Neue Schicht</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div><form class="form-grid"><div class="field full"><label>Mitarbeiter</label><select class="select" name="employeeId">${filteredEmployees().map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></div><div class="field"><label>Datum</label><input class="input" type="date" name="date" required value="${berlin().date}"></div><div class="field"><label>Standort</label><select class="select" name="locationId"><option value="${S.locationId}">${esc(loc(S.locationId)?.name)}</option></select></div><div class="field"><label>Beginn</label><input class="input" type="time" name="start" value="08:00" required></div><div class="field"><label>Ende</label><input class="input" type="time" name="end" value="16:00" required></div><div class="field full"><label>Pause</label><input class="input" type="number" name="breakMinutes" value="30" min="0"></div><div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Speichern</button></div></form>`);b.querySelector("form").addEventListener("submit",async e=>{e.preventDefault();const shift=Object.fromEntries(new FormData(e.currentTarget));shift.breakMinutes=Number(shift.breakMinutes);try{await apply({type:"ADD_SHIFT",shift});b.remove()}catch{}})}function newsModal(){const b=modal(`<div class="modal-head"><div><div class="caps muted">Team-News</div><h2>Mitteilung erstellen</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div><form class="form-grid"><div class="field full"><label>Titel</label><input class="input" name="title" required></div><div class="field full"><label>Empfänger</label><select class="select" name="audience"><option value="all">Alle</option>${S.state.locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div><div class="field full"><label>Text</label><textarea class="textarea" name="body" required></textarea></div><div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Veröffentlichen</button></div></form>`);b.querySelector("form").addEventListener("submit",async e=>{e.preventDefault();const announcement=Object.fromEntries(new FormData(e.currentTarget));try{await apply({type:"ADD_ANNOUNCEMENT",announcement});b.remove()}catch{}})}

function kioskHelpModal(){
  modal(`<div class="modal-head"><div><div class="caps muted">AoraAI Workforce</div><h2>Kiosk-Hilfe</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div><div class="kiosk-help-copy"><p>Wählen Sie Ihren Namen aus. Starten Sie danach die Arbeitszeit, beginnen oder beenden Sie eine Pause oder stempeln Sie sich zum Feierabend aus.</p><p>Alternativ können Sie Ihre Karte direkt in den gewünschten Status ziehen.</p><button class="btn" data-a="close">Verstanden</button></div>`);
}

async function compressProfilePhoto(file){
  if(!file.type.startsWith("image/"))throw new Error("Bitte eine Bilddatei auswählen.");
  if(file.size>3*1024*1024)throw new Error("Das Profilbild darf höchstens 3 MB groß sein.");
  const source=URL.createObjectURL(file);
  try{
    const image=await new Promise((resolve,reject)=>{
      const node=new Image();
      node.onload=()=>resolve(node);
      node.onerror=()=>reject(new Error("Das Bild konnte nicht gelesen werden."));
      node.src=source;
    });
    const size=Math.min(320,Math.max(image.naturalWidth,image.naturalHeight));
    const scale=Math.min(1,size/Math.max(image.naturalWidth,image.naturalHeight));
    const width=Math.max(1,Math.round(image.naturalWidth*scale));
    const height=Math.max(1,Math.round(image.naturalHeight*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width;
    canvas.height=height;
    canvas.getContext("2d").drawImage(image,0,0,width,height);
    return canvas.toDataURL("image/jpeg",0.82);
  }finally{
    URL.revokeObjectURL(source);
  }
}

function profileModal(){
  const employee=S.state.employees[0]||emp(S.session.subjectId);
  let avatarDataUrl=employee.avatarDataUrl||"";
  const dialog=modal(`<div class="modal-head"><div><div class="caps muted">Mitarbeiterkonto</div><h2>Profil bearbeiten</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div>
    <form class="form-grid" id="profile-form">
      <div class="field full profile-editor-preview">
        <div class="profile-avatar" id="profile-preview">${avatarDataUrl?`<img src="${esc(avatarDataUrl)}" alt="Profilbild">`:esc(employee.initials||initials(employee.name))}</div>
        <div><strong>${esc(employee.name)}</strong><small>Das Bild wird komprimiert und auf allen Geräten synchronisiert.</small></div>
      </div>
      <div class="field full"><label>Anzeigename</label><input class="input" name="name" value="${esc(employee.name)}" minlength="2" maxlength="80" required></div>
      <div class="field full"><label>Profilbild</label><input class="input" id="profile-file" type="file" accept="image/png,image/jpeg,image/webp"></div>
      <div class="field full actions"><button type="button" class="btn light" id="remove-profile-photo">Foto entfernen</button><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Speichern</button></div>
    </form>`);
  const preview=dialog.querySelector("#profile-preview");
  dialog.querySelector("#profile-file").addEventListener("change",async(event)=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try{
      avatarDataUrl=await compressProfilePhoto(file);
      preview.innerHTML=`<img src="${avatarDataUrl}" alt="Profilbild">`;
    }catch(error){
      toast(error.message,"error");
      event.target.value="";
    }
  });
  dialog.querySelector("#remove-profile-photo").addEventListener("click",()=>{
    avatarDataUrl="";
    preview.textContent=employee.initials||initials(employee.name);
  });
  dialog.querySelector("form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    const name=String(new FormData(event.currentTarget).get("name")||"").trim();
    if(name.length<2)return toast("Bitte einen gültigen Namen eingeben.","error");
    try{
      await apply({type:"UPDATE_PROFILE",patch:{name,avatarDataUrl}});
      dialog.remove();
    }catch{}
  });
}
