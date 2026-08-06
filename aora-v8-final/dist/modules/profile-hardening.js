"use strict";

profileModal=function(){
  const employeeId=S.session?.subjectId||S.session?.employeeId;
  const employee=(S.state?.employees||[]).find(item=>item.id===employeeId);
  if(!employee){
    toast("Das angemeldete Mitarbeiterkonto wurde nicht gefunden.","error");
    return;
  }
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
  dialog.querySelector("#profile-file").addEventListener("change",async event=>{
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
  dialog.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const name=String(new FormData(event.currentTarget).get("name")||"").trim();
    if(name.length<2)return toast("Bitte einen gültigen Namen eingeben.","error");
    try{
      await apply({type:"UPDATE_PROFILE",patch:{name,avatarDataUrl}});
      dialog.remove();
    }catch{}
  });
};
