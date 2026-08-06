"use strict";

function modal(html){
  const previousFocus=document.activeElement;
  const backdrop=document.createElement("div");
  backdrop.className="modal-backdrop";
  backdrop.innerHTML=`<section class="modal" role="dialog" aria-modal="true" tabindex="-1">${html}</section>`;
  const dialog=backdrop.querySelector(".modal");
  const nativeRemove=backdrop.remove.bind(backdrop);
  let closed=false;
  const focusable=()=>[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(node=>!node.hidden&&node.getAttribute("aria-hidden")!=="true");
  const close=()=>{
    if(closed)return;
    closed=true;
    document.removeEventListener("keydown",onKeydown,true);
    nativeRemove();
    if(previousFocus instanceof HTMLElement&&previousFocus.isConnected)previousFocus.focus();
  };
  const onKeydown=event=>{
    if(event.key==="Escape"){
      event.preventDefault();
      close();
      return;
    }
    if(event.key!=="Tab")return;
    const nodes=focusable();
    if(!nodes.length){
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first=nodes[0],last=nodes[nodes.length-1];
    if(event.shiftKey&&document.activeElement===first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey&&document.activeElement===last){
      event.preventDefault();
      first.focus();
    }
  };
  backdrop.remove=close;
  document.body.appendChild(backdrop);
  document.addEventListener("keydown",onKeydown,true);
  backdrop.addEventListener("click",event=>{
    if(event.target===backdrop||event.target.closest('[data-a="close"]'))close();
  });
  queueMicrotask(()=>{
    const target=dialog.querySelector("[autofocus]")||focusable()[0]||dialog;
    target.focus();
  });
  return backdrop;
}
function modalHeader(kicker,title){
  return`<div class="modal-head"><div><div class="caps muted">${kicker}</div><h2>${title}</h2></div><button class="circle-btn" data-a="close" aria-label="Schließen">${I.x}</button></div>`;
}
function leaveModal(){
  const backdrop=modal(`${modalHeader("Urlaub","Antrag stellen")}<form id="leave-form" class="form-grid">
    <div class="field"><label>Von</label><input class="input" type="date" name="start" required></div>
    <div class="field"><label>Bis</label><input class="input" type="date" name="end" required></div>
    <div class="field full"><label>Art</label><select class="select" name="type"><option>Urlaub</option><option>Krankheit</option><option>Unbezahlt</option></select></div>
    <div class="field full"><label>Notiz</label><textarea class="textarea" name="note"></textarea></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Senden</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const request=Object.fromEntries(new FormData(event.currentTarget));
    try{await apply({type:"REQUEST_LEAVE",request});backdrop.remove()}catch{}
  });
}
function shiftModal(){
  const backdrop=modal(`${modalHeader("Dienstplan","Neue Schicht")}<form class="form-grid">
    <div class="field full"><label>Mitarbeiter</label><select class="select" name="employeeId">${filteredEmployees().filter(employee=>employee.status!=="pending").map(employee=>`<option value="${employee.id}">${esc(employee.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Datum</label><input class="input" type="date" name="date" required value="${berlin().date}"></div>
    <div class="field"><label>Standort</label><select class="select" name="locationId"><option value="${S.locationId}">${esc(loc(S.locationId)?.name)}</option></select></div>
    <div class="field"><label>Beginn</label><input class="input" type="time" name="start" value="08:00" required></div>
    <div class="field"><label>Ende</label><input class="input" type="time" name="end" value="16:00" required></div>
    <div class="field full"><label>Pause</label><input class="input" type="number" name="breakMinutes" value="30" min="0"></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Speichern</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const shift=Object.fromEntries(new FormData(event.currentTarget));
    shift.breakMinutes=Number(shift.breakMinutes);
    try{await apply({type:"ADD_SHIFT",shift});backdrop.remove()}catch{}
  });
}
function newsModal(){
  const backdrop=modal(`${modalHeader("Team-News","Mitteilung erstellen")}<form class="form-grid">
    <div class="field full"><label>Titel</label><input class="input" name="title" required maxlength="100"></div>
    <div class="field full"><label>Empfänger</label><select class="select" name="audience"><option value="${S.locationId}">${esc(loc(S.locationId)?.name||"Aktueller Laden")}</option>${isOwner()?'<option value="all">Alle Läden</option>':""}</select></div>
    <div class="field full"><label>Text</label><textarea class="textarea" name="body" required maxlength="1000"></textarea></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Veröffentlichen</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const submit=form.querySelector('button[type="submit"]');
    if(submit?.disabled)return;
    if(submit)submit.disabled=true;
    const announcement=Object.fromEntries(new FormData(form));
    announcement.title=String(announcement.title||"").trim();
    announcement.body=String(announcement.body||"").trim();
    if(!announcement.title||!announcement.body){
      if(submit)submit.disabled=false;
      return toast("Titel und Text dürfen nicht leer sein.","error");
    }
    try{
      await apply({type:"ADD_ANNOUNCEMENT",announcement});
      backdrop.remove();
      toast("Mitteilung wurde veröffentlicht.");
    }catch{
      if(submit?.isConnected)submit.disabled=false;
    }
  });
}
function kioskHelpModal(){
  modal(`${modalHeader("AoraAI Workforce","Kiosk-Hilfe")}<div class="kiosk-help-copy"><p>Wählen Sie Ihren Namen aus. Starten Sie danach die Arbeitszeit, beginnen oder beenden Sie eine Pause oder stempeln Sie sich zum Feierabend aus.</p><p>Alternativ können Sie Ihre Karte direkt in den gewünschten Status ziehen.</p><button class="btn" data-a="close">Verstanden</button></div>`);
}

function kioskActivationResultModal(result){
  if(!result)return;
  const credentials=`Geräte-ID: ${result.deviceId}\nAktivierungscode: ${result.activationCode}\nKiosk: ${result.kioskUrl}`;
  const dialog=modal(`${modalHeader("Kiosk-Gerät","Zugangsdaten bereit")}
    <div class="activation-result">
      <p class="delivery-copy">Diese Zugangsdaten werden nur jetzt vollständig angezeigt. Bewahre den Aktivierungscode sicher am vorgesehenen Kiosk-Gerät auf.</p>
      <div><span>Geräte-ID</span><code>${esc(result.deviceId)}</code></div>
      <div><span>Aktivierungscode</span><code>${esc(result.activationCode)}</code></div>
      <div class="delivery-actions">
        <button class="btn outline" id="copy-kiosk-credentials">Zugangsdaten kopieren</button>
        <a class="btn" href="${esc(result.kioskUrl)}" target="_blank" rel="noopener">Kiosk öffnen ${I.arrow}</a>
        <button class="btn light" data-a="close">Fertig</button>
      </div>
      <p class="access-note">Ein neuer Aktivierungscode widerruft laufende Sitzungen dieses Geräts. Mitarbeiter melden sich weiterhin mit ihrem persönlichen Konto an.</p>
    </div>`);
  dialog.querySelector("#copy-kiosk-credentials")?.addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(credentials);
      toast("Kiosk-Zugangsdaten wurden kopiert.");
    }catch{
      toast("Kopieren nicht möglich. Bitte Geräte-ID und Code manuell sichern.","error");
    }
  });
}

function kioskCreateModal(){
  const location=loc(S.locationId);
  if(!location)return toast("Bitte zuerst einen Laden auswählen.","error");
  const dialog=modal(`${modalHeader("Kiosk","Gerät für ${esc(location.name)} einrichten")}<form class="form-grid">
    <div class="field full"><label>Gerätename</label><input class="input" name="name" value="Kiosk ${esc(location.name)}" required minlength="2" maxlength="80"></div>
    <div class="field full exception-summary"><strong>Sicherer lokaler Zugang</strong><p>Aora erzeugt eine Geräte-ID und einen achtstelligen Aktivierungscode. Der Code wird nur einmal angezeigt und nicht im Klartext gespeichert.</p></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Gerät erstellen</button></div>
  </form>`);
  dialog.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const submit=event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled=true;
    try{
      const name=String(new FormData(event.currentTarget).get("name")||"").trim();
      const result=await apply({type:"CREATE_KIOSK_DEVICE",name,locationId:S.locationId});
      dialog.remove();
      kioskActivationResultModal(result.kioskActivation);
    }catch(error){
      submit.disabled=false;
      toast(error.message||"Kiosk-Gerät konnte nicht erstellt werden.","error");
    }
  });
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
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL("image/jpeg",0.82);
  }finally{URL.revokeObjectURL(source)}
}
function profileModal(){
  const employee=emp(S.session.subjectId)||S.state.employees[0];
  let avatarDataUrl=employee.avatarDataUrl||"";
  const dialog=modal(`${modalHeader("Mitarbeiterkonto","Profil bearbeiten")}
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
    try{avatarDataUrl=await compressProfilePhoto(file);preview.innerHTML=`<img src="${avatarDataUrl}" alt="Profilbild">`}
    catch(error){toast(error.message,"error");event.target.value=""}
  });
  dialog.querySelector("#remove-profile-photo").addEventListener("click",()=>{avatarDataUrl="";preview.textContent=employee.initials||initials(employee.name)});
  dialog.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const name=String(new FormData(event.currentTarget).get("name")||"").trim();
    if(name.length<2)return toast("Bitte einen gültigen Namen eingeben.","error");
    try{await apply({type:"UPDATE_PROFILE",patch:{name,avatarDataUrl}});dialog.remove()}catch{}
  });
}

function locationModal(location=null){
  const edit=Boolean(location);
  const savedLatitude=location?.gpsConfigured===true||Number(location?.latitude)||Number(location?.gps?.lat)?Number(location?.gps?.lat??location?.latitude):"";
  const savedLongitude=location?.gpsConfigured===true||Number(location?.longitude)||Number(location?.gps?.lng)?Number(location?.gps?.lng??location?.longitude):"";
  const backdrop=modal(`${modalHeader("Inhaber",edit?"Laden bearbeiten":"Neuen Laden anlegen")}<form class="form-grid">
    <div class="field full"><label>Name des Ladens</label><input class="input" name="name" value="${esc(location?.name||"")}" required maxlength="80" placeholder="z. B. Maxim Wilmersdorf"></div>
    <div class="field"><label>Stadt</label><input class="input" name="city" value="${esc(location?.city||"Berlin")}" required maxlength="80"></div>
    <div class="field"><label>Land</label><input class="input" name="country" value="${esc(location?.country||"Deutschland")}" maxlength="80"></div>
    <div class="field full"><label>Adresse</label><input class="input" name="address" value="${esc(location?.address||"")}" maxlength="160" placeholder="Straße, Hausnummer, PLZ"></div>
    <div class="field"><label>Kostenstelle</label><input class="input" name="costCenter" value="${esc(location?.costCenter||"")}" maxlength="40"></div>
    <div class="field"><label>Geofence-Radius</label><input class="input" name="geofenceRadius" type="number" min="20" max="1000" value="${location?.geofenceRadius||100}"></div>
    <div class="field"><label>Breitengrad</label><input class="input" name="latitude" type="number" step="any" min="-90" max="90" value="${savedLatitude}" required></div>
    <div class="field"><label>Längengrad</label><input class="input" name="longitude" type="number" step="any" min="-180" max="180" value="${savedLongitude}" required></div>
    <div class="field full"><button class="btn outline" type="button" id="capture-geofence-position">Aktuellen Standort dieses Ladens übernehmen</button><small id="geofence-position-status">GPS wird beim Einstempeln gegen diese Position geprüft.</small></div>
    <div class="field full"><label>Zeitzone</label><input class="input" name="timezone" value="${esc(location?.timezone||"Europe/Berlin")}" required></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">${edit?"Änderungen speichern":"Laden anlegen"}</button></div>
  </form>`);
  backdrop.querySelector("#capture-geofence-position").addEventListener("click",()=>{
    const button=backdrop.querySelector("#capture-geofence-position");
    const status=backdrop.querySelector("#geofence-position-status");
    if(!navigator.geolocation)return toast("Dieses Gerät unterstützt keine Standortbestimmung.","error");
    button.disabled=true;status.textContent="Standort wird bestimmt …";
    navigator.geolocation.getCurrentPosition(position=>{
      backdrop.querySelector('[name="latitude"]').value=String(position.coords.latitude);
      backdrop.querySelector('[name="longitude"]').value=String(position.coords.longitude);
      status.textContent=`Standort übernommen · Genauigkeit ca. ${Math.round(position.coords.accuracy)} m`;
      button.disabled=false;
    },()=>{
      status.textContent="Standort konnte nicht bestimmt werden.";
      button.disabled=false;
      toast("Bitte Standortzugriff erlauben und erneut versuchen.","error");
    },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
  });
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(event.currentTarget));
    values.geofenceRadius=Number(values.geofenceRadius||100);
    values.latitude=Number(values.latitude);
    values.longitude=Number(values.longitude);
    values.gpsConfigured=true;
    if(!Number.isFinite(values.latitude)||!Number.isFinite(values.longitude)||(values.latitude===0&&values.longitude===0))return toast("Bitte einen gültigen Ladenstandort übernehmen.","error");
    try{
      await apply(edit?{type:"UPDATE_LOCATION",id:location.id,patch:values}:{type:"ADD_LOCATION",location:values});
      backdrop.remove();
    }catch{}
  });
}
function managerModal(){
  const locations=activeLocations();
  const backdrop=modal(`${modalHeader("Inhaber","Manager per E-Mail einladen")}<form class="form-grid">
    <div class="field full"><label>Name</label><input class="input" name="name" required maxlength="80"></div>
    <div class="field full"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" required autocomplete="email"></div>
    <fieldset class="field full checkbox-fieldset"><legend>Läden freigeben</legend>${locations.map(location=>`<label class="check-row"><input type="checkbox" name="locationIds" value="${location.id}"><span><strong>${esc(location.name)}</strong><small>${esc(location.city||"")}</small></span></label>`).join("")||'<div class="empty">Bitte zuerst einen Laden anlegen.</div>'}</fieldset>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit" ${locations.length?"":"disabled"}>Einladung senden</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const manager={name:String(form.get("name")||"").trim(),email:String(form.get("email")||"").trim(),locationIds:form.getAll("locationIds")};
    if(!manager.locationIds.length)return toast("Bitte mindestens einen Laden auswählen.","error");
    try{await apply({type:"INVITE_MANAGER",manager});backdrop.remove()}catch{}
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
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Konto anlegen und einladen</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=Object.fromEntries(new FormData(event.currentTarget));
    const employee={
      ...form,
      weeklyTarget:Number(form.weeklyTarget||40),
      vacationAllowance:Number(form.vacationAllowance||27.5),
      skills:String(form.skills||"").split(",").map(value=>value.trim()).filter(Boolean)
    };
    try{await apply({type:"CREATE_EMPLOYEE_ACCOUNT",employee});backdrop.remove()}catch{}
  });
}
function managerAccessModal(manager){
  const locations=activeLocations();
  const current=new Set(manager.locationIds||[]);
  const backdrop=modal(`${modalHeader("Inhaber","Manager-Zugriff ändern")}<form class="form-grid">
    <div class="field full manager-modal-summary"><div class="avatar">${esc(manager.initials||initials(manager.name))}</div><span><strong>${esc(manager.name)}</strong><small>${esc(manager.email||"")}</small></span></div>
    <fieldset class="field full checkbox-fieldset"><legend>Zugewiesene Läden</legend>${locations.map(location=>`<label class="check-row"><input type="checkbox" name="locationIds" value="${location.id}" ${current.has(location.id)?"checked":""}><span><strong>${esc(location.name)}</strong><small>${esc(location.city||"")}</small></span></label>`).join("")}</fieldset>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Zugriff speichern</button></div>
  </form>`);
  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const locationIds=new FormData(event.currentTarget).getAll("locationIds");
    if(!locationIds.length)return toast("Mindestens ein Laden ist erforderlich.","error");
    try{await apply({type:"UPDATE_MANAGER_ACCESS",id:manager.id,locationIds});backdrop.remove()}catch{}
  });
}
