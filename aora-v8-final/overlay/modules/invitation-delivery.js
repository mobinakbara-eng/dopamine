"use strict";

function invitationMailto(delivery){
  return`mailto:${encodeURIComponent(delivery.email)}?subject=${encodeURIComponent(delivery.subject)}&body=${encodeURIComponent(delivery.body)}`;
}
function invitationDeliveryModal(delivery){
  if(!delivery)return;
  const dialog=modal(`<div class="modal-head"><div><div class="caps muted">Einladung vorbereitet</div><h2>Sicher versenden</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div>
    <div class="delivery-card">
      <div class="avatar">${esc(initials(delivery.name))}</div>
      <div><strong>${esc(delivery.name)}</strong><small>${esc(delivery.email)} · ${delivery.accessRole==="manager"?"Manager / Arbeitgeber":"Mitarbeiter"}</small></div>
    </div>
    <p class="delivery-copy">Der Link ist einmalig, läuft nach sieben Tagen ab und wird nach der Kontoaktivierung unbrauchbar. Aora speichert nur den Hash des Tokens.</p>
    <div class="field"><label>Einladungslink</label><input class="input mono" id="delivery-link" value="${esc(delivery.inviteUrl)}" readonly></div>
    <div class="delivery-actions">
      <a class="btn" href="${esc(invitationMailto(delivery))}">E-Mail öffnen ${I.arrow}</a>
      <button class="btn outline" id="copy-delivery-link">Link kopieren</button>
      <button class="btn light" data-a="close">Fertig</button>
    </div>
    <p class="access-note">Aus Datenschutzgründen wird der vollständige Link nach dem Schließen nicht erneut angezeigt. Über „Erneut senden“ entsteht ein neuer Link und der alte wird ersetzt.</p>`);
  dialog.querySelector("#copy-delivery-link")?.addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(delivery.inviteUrl);
      toast("Einladungslink wurde kopiert.");
    }catch{
      const input=dialog.querySelector("#delivery-link");
      input.select();
      document.execCommand("copy");
      toast("Einladungslink wurde kopiert.");
    }
  });
}

function managerModal(){
  const locations=activeLocations();
  const backdrop=modal(`${modalHeader("Inhaber","Manager per E-Mail einladen")}<form class="form-grid">
    <div class="field full"><label>Name</label><input class="input" name="name" required maxlength="80"></div>
    <div class="field full"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" required autocomplete="email"></div>
    <fieldset class="field full checkbox-fieldset"><legend>Läden freigeben</legend>${locations.map(location=>`<label class="check-row"><input type="checkbox" name="locationIds" value="${location.id}"><span><strong>${esc(location.name)}</strong><small>${esc(location.city||"")}</small></span></label>`).join("")||'<div class="empty">Bitte zuerst einen Laden anlegen.</div>'}</fieldset>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit" ${locations.length?"":"disabled"}>Einladung vorbereiten</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const manager={name:String(form.get("name")||"").trim(),email:String(form.get("email")||"").trim(),locationIds:form.getAll("locationIds")};
    if(!manager.locationIds.length)return toast("Bitte mindestens einen Laden auswählen.","error");
    try{
      const result=await apply({type:"INVITE_MANAGER",manager});
      backdrop.remove();
      invitationDeliveryModal(result.delivery);
    }catch{}
  });
}

function employeeAccountModal(){
  const locations=isOwner()?activeLocations():S.state.locations.filter(location=>location.active!==false);
  const selected=S.locationId||locations[0]?.id;
  const backdrop=modal(`${modalHeader("Arbeitgeber","Mitarbeiterkonto anlegen")}<form class="form-grid">
    <div class="field full"><label>Name</label><input class="input" name="name" required maxlength="80"></div>
    <div class="field full"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" required autocomplete="email"></div>
    <div class="field"><label>Rolle / Position</label><input class="input" name="role" value="Mitarbeiter" required maxlength="80"></div>
    <div class="field"><label>Laden</label><select class="select" name="locationId">${locations.map(location=>`<option value="${location.id}" ${location.id===selected?"selected":""}>${esc(location.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Wochenstunden</label><input class="input" name="weeklyTarget" type="number" min="1" max="60" value="40"></div>
    <div class="field"><label>Urlaubsanspruch</label><input class="input" name="vacationAllowance" type="number" min="0" max="60" step="0.5" value="27.5"></div>
    <div class="field full"><label>Skills (mit Komma trennen)</label><input class="input" name="skills" placeholder="Bar, Kasse, Service"></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Konto anlegen und Einladung vorbereiten</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=Object.fromEntries(new FormData(event.currentTarget));
    const employee={...form,weeklyTarget:Number(form.weeklyTarget||40),vacationAllowance:Number(form.vacationAllowance||27.5),skills:String(form.skills||"").split(",").map(value=>value.trim()).filter(Boolean)};
    try{
      const result=await apply({type:"CREATE_EMPLOYEE_ACCOUNT",employee});
      backdrop.remove();
      invitationDeliveryModal(result.delivery);
    }catch{}
  });
}
