"use strict";

accessShell=function(card){
  return`<div class="access-shell">
    <main class="access-portal">
      <header class="access-brand">${logo}<div class="caps">AoraAI Workforce</div></header>
      <section class="access-card">${card}</section>
      <footer class="access-footer">© ${new Date().getFullYear()} AoraAI. Alle Rechte vorbehalten.</footer>
    </main>
  </div>`;
};

renderLoading=function(){
  app.innerHTML=accessShell(`<h2>Anmeldung wird geladen …</h2><div class="progress" style="margin-top:25px"><span style="width:65%"></span></div>`);
};

renderError=function(message){
  app.innerHTML=accessShell(`<h2>Verbindung nicht möglich</h2><p class="access-explanation">${esc(message)}</p><button class="btn access-submit" data-a="retry">Erneut versuchen</button>`);
};

passwordLogin=async function(email,password){
  const session=await access({action:"passwordLogin",email,password});
  if(!["owner","manager","employee"].includes(session.accessRole)){
    throw Object.assign(new Error("Die Kontorolle ist ungültig."),{status:403});
  }
  activateSession(session,session.accessRole);
  await loadState();
  return session;
};

renderLogin=function(message=""){
  const kiosk=S.loginRole==="kiosk"||S.accessRole==="kiosk";
  const directory=S.directory||{};

  if(kiosk){
    if(directory.kioskAvailable===false){
      app.innerHTML=accessShell(`
        <div class="access-intro"><h1>Kiosk einrichten</h1><p>Für diesen Arbeitsbereich wurde noch kein Kiosk-Gerät angelegt.</p></div>
        <div class="access-empty-state" role="status">
          <span class="material-symbols-rounded" aria-hidden="true">desktop_windows</span>
          <strong>Manager-Zugang erforderlich</strong>
          <p>Ein Manager legt zuerst unter „Kiosk“ ein Gerät an und erhält anschließend den einmaligen Aktivierungscode.</p>
        </div>
        <a class="btn access-submit" href="${esc(accessPath("manager"))}">Zum Manager-Login ${I.arrow}</a>`);
      return;
    }
    app.innerHTML=accessShell(`
      <div class="access-intro"><h1>Kiosk aktivieren</h1><p>Dieses gemeinsam genutzte Gerät sicher mit einem Laden verbinden.</p></div>
      ${message?`<div class="login-success">${esc(message)}</div>`:""}
      <form id="pin-login" aria-describedby="kiosk-login-feedback">
        <div class="field"><label>Geräte-ID</label><input class="input" name="subject" type="text" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="kiosk_…"></div>
        <div class="field"><label>Aktivierungscode</label><input class="input" name="pin" type="password" required autocomplete="current-password"></div>
        <p class="access-note">Geräte-ID und Aktivierungscode werden nach dem Anlegen des Kiosks einmalig im Manager-Bereich angezeigt.</p>
        <p class="access-feedback" id="kiosk-login-feedback" role="status" aria-live="polite"></p>
        <button class="btn access-submit" type="submit">Kiosk aktivieren ${I.arrow}</button>
      </form>`);

    document.getElementById("pin-login")?.addEventListener("submit",async event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const button=event.currentTarget.querySelector('button[type="submit"]');
      const feedback=document.getElementById("kiosk-login-feedback");
      if(feedback)feedback.textContent="";
      if(button){button.disabled=true;button.textContent="Wird aktiviert …"}
      try{await login("kiosk",String(form.get("subject")||""),String(form.get("pin")||""))}
      catch(error){if(feedback)feedback.textContent=error.message;toast(error.message,"error");if(button){button.disabled=false;button.innerHTML=`Kiosk aktivieren ${I.arrow}`}}
    });
    return;
  }

  app.innerHTML=accessShell(`
    <div class="access-intro"><h1>Willkommen</h1><p>Melden Sie sich bei Ihrem AoraAI Workforce Konto an.</p></div>
    ${message?`<div class="login-success">${esc(message)}</div>`:""}
    <form id="password-login" aria-describedby="password-login-feedback">
      <div class="field"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" inputmode="email" autocomplete="email" required placeholder="name@firma.de" autofocus></div>
      <div class="field"><label>Passwort</label><div class="access-password-control"><input class="input" name="password" type="password" autocomplete="current-password" required minlength="10"><button type="button" class="access-password-toggle" aria-label="Passwort anzeigen" aria-pressed="false"><span class="material-symbols-rounded" aria-hidden="true">visibility</span></button></div></div>
      <a class="access-forgot" href="mailto:mobinakbara@gmail.com?subject=AoraAI%20Passwort%20zur%C3%BCcksetzen">Passwort vergessen?</a>
      <p class="access-feedback" id="password-login-feedback" role="status" aria-live="polite"></p>
      <button class="btn access-submit" type="submit">Anmelden ${I.arrow}</button>
    </form>
    <div class="access-trust"><span class="material-symbols-rounded" aria-hidden="true">verified_user</span><p>Automatische Rollenweiterleitung nach erfolgreicher Anmeldung. Ihre Sitzung wird sicher und nur in diesem Browser-Tab gespeichert.</p></div>
    <div class="access-secondary"><nav class="access-links" aria-label="Hilfe"><a href="mailto:mobinakbara@gmail.com?subject=AoraAI%20Support">Support</a><span aria-hidden="true">|</span><a href="mailto:mobinakbara@gmail.com?subject=AoraAI%20Datenschutz">Datenschutz</a></nav><a class="btn outline" href="${esc(accessPath("kiosk"))}">Kiosk aktivieren <span class="material-symbols-rounded" aria-hidden="true">desktop_windows</span></a></div>`);

  document.querySelector(".access-password-toggle")?.addEventListener("click",event=>{
    const button=event.currentTarget;
    const input=document.querySelector('#password-login input[name="password"]');
    const reveal=input.type==="password";
    input.type=reveal?"text":"password";
    button.setAttribute("aria-pressed",String(reveal));
    button.setAttribute("aria-label",reveal?"Passwort ausblenden":"Passwort anzeigen");
    button.querySelector(".material-symbols-rounded").textContent=reveal?"visibility_off":"visibility";
    input.focus();
  });

  document.getElementById("password-login")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const button=event.currentTarget.querySelector('button[type="submit"]');
    const feedback=document.getElementById("password-login-feedback");
    if(feedback)feedback.textContent="";
    if(button){button.disabled=true;button.textContent="Anmeldung läuft …"}
    try{await passwordLogin(String(form.get("email")||"").trim(),String(form.get("password")||""))}
    catch(error){if(feedback)feedback.textContent=error.message;toast(error.message,"error");if(button){button.disabled=false;button.innerHTML=`Anmelden ${I.arrow}`}}
  });
};

