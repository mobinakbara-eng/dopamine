"use strict";

accessShell=function(card){
  return`<div class="access-shell">
    <section class="access-brand">
      <div>${logo}</div>
      <div><div class="caps" style="color:#888">AoraAI Workforce</div></div>
      <span></span>
    </section>
    <section class="access-panel"><div class="access-card">${card}</div></section>
  </div>`;
};

renderLoading=function(){
  app.innerHTML=accessShell(`<h2>Anmeldung wird geladen …</h2><div class="progress" style="margin-top:25px"><span style="width:65%"></span></div>`);
};

renderError=function(message){
  app.innerHTML=accessShell(`<h2>Verbindung nicht möglich</h2><p class="access-explanation">${esc(message)}</p><button class="btn access-submit" data-a="retry">Erneut versuchen</button>`);
};

passwordLogin=async function(email,password){
  const preferred=S.loginRole&&S.loginRole!=="kiosk"?S.loginRole:null;
  const roles=[preferred,"owner","manager","employee"].filter((role,index,list)=>role&&list.indexOf(role)===index);
  let authenticationError=null;
  let rateLimitError=null;

  for(const accessRole of roles){
    try{
      const session=await access({action:"passwordLogin",accessRole,email,password});
      activateSession(session,session.accessRole||accessRole);
      await loadState();
      return session;
    }catch(error){
      if(Number(error?.status)===401){authenticationError=error;continue}
      if(Number(error?.status)===429){rateLimitError=error;continue}
      throw error;
    }
  }

  throw rateLimitError||authenticationError||Object.assign(new Error("E-Mail oder Passwort ist nicht korrekt."),{status:401});
};

renderLogin=function(message=""){
  const kiosk=S.loginRole==="kiosk"||S.accessRole==="kiosk";
  const directory=S.directory||{kioskDevices:[]};

  if(kiosk){
    const items=loginItems("kiosk",directory);
    app.innerHTML=accessShell(`
      <h2>Kiosk aktivieren</h2>
      ${message?`<div class="login-success">${esc(message)}</div>`:""}
      <form id="pin-login">
        <div class="field"><label>Gerät</label>
          <select class="select" name="subject" required>
            ${items.map(item=>`<option value="${esc(item.id)}">${esc(item.name||item.display_name||item.id)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Aktivierungscode</label><input class="input" name="pin" type="password" required autocomplete="current-password"></div>
        <button class="btn access-submit" type="submit">Kiosk aktivieren ${I.arrow}</button>
      </form>`);

    document.getElementById("pin-login")?.addEventListener("submit",async event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const button=event.currentTarget.querySelector('button[type="submit"]');
      if(button){button.disabled=true;button.textContent="Wird aktiviert …"}
      try{await login("kiosk",String(form.get("subject")||""),String(form.get("pin")||""))}
      catch(error){toast(error.message,"error");if(button){button.disabled=false;button.innerHTML=`Kiosk aktivieren ${I.arrow}`}}
    });
    return;
  }

  app.innerHTML=accessShell(`
    <h2>Anmelden</h2>
    ${message?`<div class="login-success">${esc(message)}</div>`:""}
    <form id="password-login">
      <div class="field"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" inputmode="email" autocomplete="email" required placeholder="name@firma.de" autofocus></div>
      <div class="field"><label>Passwort</label><input class="input" name="password" type="password" autocomplete="current-password" required minlength="10"></div>
      <button class="btn access-submit" type="submit">Anmelden ${I.arrow}</button>
    </form>`);

  document.getElementById("password-login")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const button=event.currentTarget.querySelector('button[type="submit"]');
    if(button){button.disabled=true;button.textContent="Anmeldung läuft …"}
    try{await passwordLogin(String(form.get("email")||"").trim(),String(form.get("password")||""))}
    catch(error){toast(error.message,"error");if(button){button.disabled=false;button.innerHTML=`Anmelden ${I.arrow}`}}
  });
};
