"use strict";

function renderLoading(){
  app.innerHTML=`<div class="access-shell"><section class="access-brand"><div class="logo-wrap">${logo}</div><div><h1>Arbeit, klar organisiert.</h1><p>AoraAI lÃ¤dt deinen Arbeitsbereich.</p></div><span></span></section><section class="access-panel"><div class="access-card"><h2>Bitte warten â€¦</h2><div class="progress" style="margin-top:25px"><span style="width:65%"></span></div></div></section></div>`;
}
function renderError(message){
  app.innerHTML=`<div class="access-shell"><section class="access-brand"><div>${logo}</div><div><h1>Verbindung nicht mÃ¶glich.</h1><p>${esc(message)}</p></div><span></span></section><section class="access-panel"><div class="access-card"><button class="btn" data-a="retry">Erneut versuchen</button></div></section></div>`;
}
function accessLabel(role){return({owner:"Inhaber",manager:"Arbeitgeber",employee:"Mitarbeiter",kiosk:"Kiosk"})[role]||role}
function loginItems(role,directory){return role==="kiosk"?(directory.kioskDevices||[]):[]}
function accessShell(card){
  return`<div class="access-shell">
    <section class="access-brand">
      <div>${logo}</div>
      <div>
        <div class="caps" style="color:#888;margin-bottom:17px">AoraAI Workforce Â· Version 8</div>
        <h1>Ein System.<br>Alle im Takt.</h1>
        <p>Dienstplanung, Arbeitszeit, Urlaub und Teamkommunikation â€“ mit klar getrennten ZugÃ¤ngen fÃ¼r Inhaber, Arbeitgeber und Mitarbeiter.</p>
      </div>
      <div class="small" style="color:#777">Original AoraAI Identity Â· isolierte Version ${CFG.version}</div>
    </section>
    <section class="access-panel"><div class="access-card">${card}</div></section>
  </div>`;
}
function renderLogin(message=""){
  const role=S.loginRole||S.accessRole;
  const directory=S.directory||{kioskDevices:[]};
  const items=loginItems(role,directory);
  const passwordEnabled=role==="owner"||role==="manager"||role==="employee";
  const pinEnabled=role==="kiosk";
  const roleTabs=[["owner","Inhaber"],["manager","Arbeitgeber"],["employee","Mitarbeiter"],["kiosk","Kiosk"]];
  app.innerHTML=accessShell(`
    <div class="caps muted">AoraAI Workforce</div>
    <h2 style="margin-top:8px">${accessLabel(role)}-Zugang</h2>
    <div class="role-tabs role-tabs-four">
      ${roleTabs.map(([id,label])=>`<button class="role-tab ${id===role?"active":""}" data-a="role" data-role="${id}">${label}</button>`).join("")}
    </div>
    ${message?`<div class="login-success">${esc(message)}</div>`:""}
    ${passwordEnabled?`<form id="password-login">
      <div class="field"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" autocomplete="email" required placeholder="name@firma.de"></div>
      <div class="field"><label>Passwort</label><input class="input" name="password" type="password" autocomplete="current-password" required minlength="10"></div>
      <button class="btn access-submit" type="submit">Anmelden ${I.arrow}</button>
      <p class="access-note">Inhaber, Arbeitgeber und Mitarbeiter melden sich ausschlieÃŸlich mit ihrem persÃ¶nlichen E-Mail-Konto an.</p>
    </form>`:""}
    ${pinEnabled?`<form id="pin-login">
      <div class="field"><label>GerÃ¤t</label>
        <select class="select" name="subject" required>
          ${items.map(item=>`<option value="${esc(item.id)}">${esc(item.name||item.display_name||item.id)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Aktivierungscode</label><input class="input" name="pin" type="password" required autocomplete="current-password"></div>
      <button class="btn access-submit" type="submit">Kiosk aktivieren ${I.arrow}</button>
      <p class="access-note">Der Aktivierungscode gilt nur fÃ¼r das lokale Kiosk-GerÃ¤t und ersetzt keine MitarbeiterbestÃ¤tigung.</p>
    </form>`:""}`);
  document.getElementById("password-login")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    try{await passwordLogin(String(form.get("email")||"").trim(),String(form.get("password")||""))}
    catch(error){toast(error.message,"error")}
  });
  document.getElementById("pin-login")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    try{await login(role,String(form.get("subject")),String(form.get("pin")))}catch(error){toast(error.message,"error")}
  });
}
function renderInvitationSetup(info,invitationId,token){
  if(!info?.valid){
    app.innerHTML=accessShell(`<div class="caps muted">Einladung</div><h2 style="margin-top:8px">Link nicht mehr gÃ¼ltig</h2><p class="access-explanation">Die Einladung wurde bereits verwendet, widerrufen oder ist abgelaufen. Bitte den Inhaber oder Manager um einen neuen Link.</p><button class="btn access-submit" data-a="invitation-back">Zur Anmeldung</button>`);
    return;
  }
  const role=info.kind==="manager"?"Arbeitgeber / Manager":"Mitarbeiter";
  app.innerHTML=accessShell(`<div class="caps muted">Einladung Â· ${esc(role)}</div>
    <h2 style="margin-top:8px">Konto aktivieren</h2>
    <div class="invitation-summary"><strong>${esc(info.name)}</strong><span>${esc(info.emailHint)}</span><small>Einmaliger Link Â· gÃ¼ltig bis ${esc(new Date(info.expiresAt).toLocaleString("de-DE"))}</small></div>
    <form id="invitation-accept">
      <div class="field"><label>E-Mail-Adresse bestÃ¤tigen</label><input class="input" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label>Neues Passwort</label><input class="input" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div>
      <div class="field"><label>Passwort wiederholen</label><input class="input" name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div>
      <div class="password-rules">Mindestens 10 Zeichen, GroÃŸ- und Kleinbuchstaben sowie eine Zahl.</div>
      <button class="btn access-submit" type="submit">Konto aktivieren ${I.arrow}</button>
    </form>`);
  document.getElementById("invitation-accept")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget),password=String(form.get("password")||""),confirm=String(form.get("confirm")||"");
    if(password!==confirm)return toast("Die PasswÃ¶rter stimmen nicht Ã¼berein.","error");
    try{
      await acceptInvitation(invitationId,token,String(form.get("email")||"").trim(),password);
      toast("Konto wurde aktiviert.");
    }catch(error){toast(error.message,"error")}
  });
}
function render(){
  if(!S.state||!S.session)return renderLogin();
  S.role==="admin"?renderAdmin():S.role==="kiosk"?renderKiosk():renderEmployee();
}

