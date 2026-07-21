"use strict";

function renderLoading(){
  app.innerHTML=`<div class="access-shell"><section class="access-brand"><div class="logo-wrap">${logo}</div><div><h1>Arbeit, klar organisiert.</h1><p>AoraAI lädt deinen Arbeitsbereich.</p></div><span></span></section><section class="access-panel"><div class="access-card"><h2>Bitte warten …</h2><div class="progress" style="margin-top:25px"><span style="width:65%"></span></div></div></section></div>`;
}
function renderError(message){
  app.innerHTML=`<div class="access-shell"><section class="access-brand"><div>${logo}</div><div><h1>Verbindung nicht möglich.</h1><p>${esc(message)}</p></div><span></span></section><section class="access-panel"><div class="access-card"><button class="btn" data-a="retry">Erneut versuchen</button></div></section></div>`;
}
function accessLabel(role){return({owner:"Inhaber",manager:"Arbeitgeber",employee:"Mitarbeiter",kiosk:"Kiosk"})[role]||role}
function loginItems(role,directory){
  if(role==="owner")return(directory.admins||[]).filter(item=>(item.scope||"owner")==="owner");
  if(role==="manager")return(directory.admins||[]).filter(item=>item.scope==="manager"&&item.status==="active");
  if(role==="employee")return(directory.employees||[]).filter(item=>item.status!=="pending");
  return directory.kioskDevices||[];
}
function renderLogin(message=""){
  const role=S.loginRole||S.accessRole;
  const directory=S.directory||{admins:[],employees:[],kioskDevices:[]};
  const items=loginItems(role,directory);
  const emailEnabled=role==="owner"||role==="manager"||role==="employee";
  const pinEnabled=role==="owner"||role==="kiosk";
  const roleTabs=[["owner","Inhaber"],["manager","Arbeitgeber"],["employee","Mitarbeiter"],["kiosk","Kiosk"]];
  app.innerHTML=`<div class="access-shell">
    <section class="access-brand">
      <div>${logo}</div>
      <div>
        <div class="caps" style="color:#888;margin-bottom:17px">AoraAI Workforce · Version 8</div>
        <h1>Ein System.<br>Alle im Takt.</h1>
        <p>Dienstplanung, Arbeitszeit, Urlaub und Teamkommunikation – mit klar getrennten Zugängen für Inhaber, Arbeitgeber und Mitarbeiter.</p>
      </div>
      <div class="small" style="color:#777">Original AoraAI Identity · isolierte Version ${CFG.version}</div>
    </section>
    <section class="access-panel">
      <div class="access-card">
        <div class="caps muted">AoraAI Workforce</div>
        <h2 style="margin-top:8px">${accessLabel(role)}-Zugang</h2>
        <div class="role-tabs role-tabs-four">
          ${roleTabs.map(([id,label])=>`<button class="role-tab ${id===role?"active":""}" data-a="role" data-role="${id}">${label}</button>`).join("")}
        </div>
        ${message?`<div class="login-success">${esc(message)}</div>`:""}
        ${emailEnabled?`<form id="magic-login">
          <div class="field"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" autocomplete="email" required placeholder="name@firma.de"></div>
          <button class="btn access-submit" type="submit">Sicheren Anmeldelink senden ${I.arrow}</button>
          <p class="access-note">Der Link ist nur für eingeladene Konten gültig. Es wird nicht angezeigt, ob eine E-Mail registriert ist.</p>
        </form>`:""}
        ${emailEnabled&&pinEnabled?`<div class="access-divider"><span>oder Bestandszugang</span></div>`:""}
        ${pinEnabled?`<form id="pin-login">
          <div class="field"><label>${role==="kiosk"?"Gerät":"Zugang"}</label>
            <select class="select" name="subject" required>
              ${items.map(item=>`<option value="${esc(item.id)}">${esc(item.name||item.display_name||item.id)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>${role==="kiosk"?"Aktivierungscode":"PIN"}</label><input class="input" name="pin" type="password" required autocomplete="current-password"></div>
          <button class="btn ${emailEnabled?"outline":""} access-submit" type="submit">Weiter ${I.arrow}</button>
          <p class="access-note">Geschützte Sitzung für die isolierte V8-Version.</p>
        </form>`:""}
      </div>
    </section>
  </div>`;
  document.getElementById("magic-login")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const email=String(new FormData(event.currentTarget).get("email")||"").trim();
    try{await sendMagicLink(email)}catch(error){toast(error.message,"error")}
  });
  document.getElementById("pin-login")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    try{await login(role,String(form.get("subject")),String(form.get("pin")))}catch(error){toast(error.message,"error")}
  });
}
function render(){
  if(!S.state||!S.session)return renderLogin();
  S.role==="admin"?renderAdmin():S.role==="kiosk"?renderKiosk():renderEmployee();
}
