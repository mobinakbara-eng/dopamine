"use strict";

CFG.accountRecoveryFunction=window.__AORA_RUNTIME_CONFIG__?.functions?.accountRecovery||"aora-v8-account-recovery";

async function productionCall(action,payload={}){
  const envelope=await request(CFG.accountRecoveryFunction,{action,workspaceSlug:CFG.slug,...payload});
  if(envelope?.error)throw Object.assign(new Error(envelope.error.message||"Aktion fehlgeschlagen."),{data:envelope});
  return envelope?.data;
}
function productionResetParams(){
  const params=new URLSearchParams(location.search);
  const path=location.pathname.replace(/\/+$/,"");
  if(!path.endsWith("/reset-password"))return null;
  const requestId=params.get("request")||"";
  const resetToken=params.get("token")||"";
  return requestId&&resetToken?{requestId,resetToken}:null;
}
function enhanceLoginLinks(){
  const forgot=document.querySelector(".access-forgot");
  if(forgot){
    forgot.setAttribute("href","#");
    forgot.dataset.productionAction="request-reset";
  }
  const links=[...document.querySelectorAll(".access-links a")];
  const support=links.find(link=>/Support/i.test(link.textContent||""));
  const privacy=links.find(link=>/Datenschutz/i.test(link.textContent||""));
  if(support){support.setAttribute("href","#");support.dataset.productionAction="support"}
  if(privacy){privacy.setAttribute("href","#");privacy.dataset.productionAction="privacy"}
}
function renderPasswordReset(message=""){
  const params=productionResetParams();
  if(!params){
    history.replaceState({},"",accessPath("employee"));
    return renderLogin("Der Reset-Link ist unvollständig.");
  }
  app.innerHTML=accessShell(`
    <div class="access-intro"><h1>Neues Passwort</h1><p>Setze ein neues Passwort für dein AoraAI-Konto. Der Link ist einmalig und zeitlich begrenzt.</p></div>
    ${message?`<div class="login-success">${esc(message)}</div>`:""}
    <form id="production-reset-form" aria-describedby="production-reset-feedback">
      <div class="field"><label>Neues Passwort</label><input class="input" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required autofocus></div>
      <div class="field"><label>Passwort wiederholen</label><input class="input" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div>
      <p class="access-note">Mindestens 10 Zeichen, Groß- und Kleinbuchstaben sowie eine Zahl. Bekannte kompromittierte Passwörter werden abgelehnt.</p>
      <p class="access-feedback" id="production-reset-feedback" role="status" aria-live="polite"></p>
      <button class="btn access-submit" type="submit">Passwort speichern ${I.arrow}</button>
    </form>`);
  document.getElementById("production-reset-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const password=String(form.get("password")||"");
    const confirmation=String(form.get("confirmPassword")||"");
    const feedback=document.getElementById("production-reset-feedback");
    const button=event.currentTarget.querySelector('button[type="submit"]');
    if(password!==confirmation){if(feedback)feedback.textContent="Die Passwörter stimmen nicht überein.";return}
    button.disabled=true;
    if(feedback)feedback.textContent="";
    try{
      const result=await productionCall("resetPassword",{...params,password});
      const role=["owner","manager","employee"].includes(result.accessRole)?result.accessRole:"employee";
      history.replaceState({},"",accessPath(role));
      setAccessRole(role);
      renderLogin("Passwort wurde geändert. Bitte neu anmelden.");
    }catch(error){
      if(feedback)feedback.textContent=error.message;
      button.disabled=false;
    }
  });
}

const productionBaseRenderLogin=renderLogin;
renderLogin=function(message=""){
  if(productionResetParams())return renderPasswordReset(message);
  productionBaseRenderLogin(message);
  queueMicrotask(enhanceLoginLinks);
};

function resetRequestModal(){
  const backdrop=modal(`${modalHeader("Kontozugang","Passwort zurücksetzen")}<form class="form-grid" id="production-reset-request-form">
    <p class="field full access-note">Gib die E-Mail-Adresse deines Kontos ein. Aus Sicherheitsgründen zeigt AoraAI immer dieselbe Bestätigung an. Der Inhaber erhält die Anfrage und erstellt einen einmaligen Reset-Link.</p>
    <div class="field full"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" autocomplete="email" required autofocus></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Anfrage senden</button></div>
  </form>`);
  backdrop.querySelector("form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button[type="submit"]');
    button.disabled=true;
    try{
      await productionCall("requestReset",{email:String(new FormData(event.currentTarget).get("email")||"").trim()});
      event.currentTarget.innerHTML='<div class="login-success">Falls ein aktives Konto existiert, wurde die Anfrage sicher an den Inhaber weitergegeben.</div><div class="actions" style="margin-top:18px"><button type="button" class="btn" data-a="close">Fertig</button></div>';
    }catch(error){toast(error.message,"error");button.disabled=false}
  });
}
function supportRequestModal(){
  const backdrop=modal(`${modalHeader("AoraAI Support","Support-Anfrage")}<form class="form-grid" id="production-support-form">
    <div class="field full"><label>E-Mail-Adresse</label><input class="input" name="email" type="email" autocomplete="email" required autofocus></div>
    <div class="field full"><label>Betreff</label><input class="input" name="subject" maxlength="120" required></div>
    <div class="field full"><label>Nachricht</label><textarea class="textarea" name="message" minlength="10" maxlength="4000" required></textarea></div>
    <p class="field full access-note">Die Anfrage wird verschlüsselt im AoraAI-Arbeitsbereich gespeichert und ist nur für den Inhaber sichtbar.</p>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Anfrage senden</button></div>
  </form>`);
  backdrop.querySelector("form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const button=event.currentTarget.querySelector('button[type="submit"]');
    button.disabled=true;
    try{
      await productionCall("requestSupport",{email:String(data.get("email")||"").trim(),subject:String(data.get("subject")||"").trim(),message:String(data.get("message")||"").trim()});
      event.currentTarget.innerHTML='<div class="login-success">Deine Support-Anfrage wurde sicher übermittelt.</div><div class="actions" style="margin-top:18px"><button type="button" class="btn" data-a="close">Fertig</button></div>';
    }catch(error){toast(error.message,"error");button.disabled=false}
  });
}
function privacyModal(){
  modal(`${modalHeader("Datenschutz","Datenschutzhinweise")}<div class="delivery-copy" style="display:grid;gap:14px;max-height:65vh;overflow:auto">
    <p><strong>Verantwortung.</strong> Verantwortlich für Beschäftigtendaten ist der Betreiber des jeweiligen AoraAI-Arbeitsbereichs. AoraAI Workforce stellt die technische Plattform bereit.</p>
    <p><strong>Verarbeitete Daten.</strong> Konto- und Kontaktdaten, Standortzuordnung, Dienstpläne, Arbeitszeiten, Abwesenheiten, Aufgaben, Nachweise, Geräte- und Sicherheitsprotokolle sowie freiwillige Support-Inhalte.</p>
    <p><strong>Zwecke.</strong> Personal- und Einsatzplanung, gesetzeskonforme Arbeitszeiterfassung, sichere Kiosk-Bestätigung, Aufgabennachweise, Support, Missbrauchsschutz und technische Fehleranalyse.</p>
    <p><strong>Rechtsgrundlagen.</strong> Beschäftigungsverhältnis und Vertragserfüllung, gesetzliche Pflichten, berechtigte Interessen an sicherem Betrieb sowie Einwilligung, soweit eine Funktion dies verlangt.</p>
    <p><strong>Empfänger.</strong> Berechtigte Inhaber und Manager des Arbeitsbereichs sowie technische Auftragsverarbeiter für Hosting und Datenbankbetrieb. Zugriffe werden rollen- und standortbezogen begrenzt.</p>
    <p><strong>Speicherung.</strong> Daten werden nur so lange gespeichert, wie sie für Betrieb, gesetzliche Nachweise oder die Bearbeitung offener Vorgänge erforderlich sind. Arbeitszeit- und Auditdaten können längeren gesetzlichen Aufbewahrungsfristen unterliegen.</p>
    <p><strong>Rechte.</strong> Betroffene können Auskunft, Berichtigung, Löschung oder Einschränkung verlangen und einer Verarbeitung widersprechen, soweit keine gesetzlichen Pflichten entgegenstehen. Nutze dafür die Support-Anfrage.</p>
    <p><strong>Sicherheit.</strong> AoraAI verwendet rollenbasierte Zugriffe, Mandantentrennung, serverseitige Sitzungen, verschlüsselte Übertragung, unveränderbare Ereignisprotokolle und zeitlich begrenzte Einmal-Links.</p>
  </div><div class="actions" style="margin-top:18px"><button class="btn" data-a="close">Schließen</button></div>`);
}

function employeeNotificationRows(){
  const employeeId=S.session?.subjectId;
  return(S.state?.notifications||[]).filter(item=>String(item.employeeId||item.employee_id||employeeId)===String(employeeId));
}
function adminLocalRows(){
  const rows=[];
  const invitations=(S.state?.invitations||[]).filter(item=>item.status==="pending");
  const leave=(S.state?.leaveRequests||[]).filter(item=>item.status==="pending");
  const corrections=(S.state?.correctionRequests||[]).filter(item=>item.status==="pending");
  if(invitations.length)rows.push({title:`${invitations.length} offene Einladung(en)`,body:"Einladungen erneut senden oder widerrufen.",view:"invitations"});
  if(leave.length)rows.push({title:`${leave.length} offene Abwesenheit(en)`,body:"Anträge prüfen und entscheiden.",view:"leave"});
  if(corrections.length)rows.push({title:`${corrections.length} offene Zeitkorrektur(en)`,body:"Korrekturanfragen im Compliance Center prüfen.",view:"compliance"});
  return rows;
}
function resetDeliveryModal(delivery){
  const mailto=`mailto:${encodeURIComponent(delivery.email)}?subject=${encodeURIComponent(delivery.subject)}&body=${encodeURIComponent(delivery.body)}`;
  const backdrop=modal(`${modalHeader("Kontowiederherstellung","Reset-Link erstellt")}<div class="delivery-card"><div class="avatar">${esc(initials(delivery.name))}</div><div><strong>${esc(delivery.name)}</strong><small>${esc(delivery.email)}</small></div></div>
    <p class="delivery-copy">Der Link ist einmalig, 30 Minuten gültig und wird nach erfolgreicher Verwendung unbrauchbar. Alle bestehenden Sitzungen des Kontos werden beendet.</p>
    <div class="field"><label>Reset-Link</label><input class="input mono" id="production-reset-link" value="${esc(delivery.resetUrl)}" readonly></div>
    <div class="delivery-actions"><a class="btn" href="${esc(mailto)}">E-Mail öffnen ${I.arrow}</a><button class="btn outline" data-production-action="copy-reset-link">Link kopieren</button><button class="btn light" data-a="close">Fertig</button></div>`);
  backdrop.querySelector('[data-production-action="copy-reset-link"]')?.addEventListener("click",async()=>{
    const input=backdrop.querySelector("#production-reset-link");
    try{await navigator.clipboard.writeText(delivery.resetUrl)}catch{input.select();document.execCommand("copy")}
    toast("Reset-Link wurde kopiert.");
  });
}
async function renderNotificationCenter(backdrop){
  const dialog=backdrop.querySelector(".modal");
  if(S.accessRole==="employee"){
    const notes=employeeNotificationRows();
    const unread=notes.filter(item=>item.read!==true);
    dialog.innerHTML=`${modalHeader("AoraAI","Benachrichtigungen")}<div class="mobile-list">${notes.map(item=>`<div class="mobile-row"><div><strong>${esc(item.title||"Hinweis")}</strong><small>${esc(item.body||"")}</small></div>${item.read?'<span class="status-chip">Gelesen</span>':'<span class="dot"></span>'}</div>`).join("")||'<div class="empty">Keine Benachrichtigungen.</div>'}</div>${unread.length?'<div class="actions" style="margin-top:18px"><button class="btn" data-production-action="mark-all-read">Alle als gelesen markieren</button></div>':""}`;
    return;
  }
  const local=adminLocalRows();
  let remote={passwordResets:[],supportRequests:[]};
  try{remote=await productionCall("listRequests",{token:S.session?.token})}catch(error){toast(error.message,"error")}
  dialog.innerHTML=`${modalHeader("AoraAI","Benachrichtigungen & Anfragen")}<div class="mobile-list">
    ${local.map(item=>`<button class="mobile-row" data-production-action="admin-view" data-view="${item.view}"><div><strong>${esc(item.title)}</strong><small>${esc(item.body)}</small></div>${I.arrow}</button>`).join("")}
    ${(remote.passwordResets||[]).map(item=>`<div class="mobile-row"><div><strong>Passwort-Reset · ${esc(item.email)}</strong><small>${item.status==="approved"?`Link gültig bis ${esc(new Date(item.expires_at).toLocaleString("de-DE"))}`:"Wartet auf Freigabe"}</small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-production-action="approve-reset" data-id="${item.id}">${item.status==="approved"?"Neuen Link":"Freigeben"}</button><button class="btn light" data-production-action="cancel-reset" data-id="${item.id}">Ablehnen</button></div></div>`).join("")}
    ${(remote.supportRequests||[]).map(item=>`<div class="mobile-row"><div><strong>${esc(item.subject)}</strong><small>${esc(item.email)} · ${esc(item.message)}</small></div><button class="btn light" data-production-action="close-support" data-id="${item.id}">Erledigt</button></div>`).join("")}
    ${!local.length&&!remote.passwordResets?.length&&!remote.supportRequests?.length?'<div class="empty">Keine offenen Benachrichtigungen.</div>':""}
  </div>`;
}
function notificationCenter(){
  const backdrop=modal(`${modalHeader("AoraAI","Benachrichtigungen")}<div class="empty">Benachrichtigungen werden geladen …</div>`);
  renderNotificationCenter(backdrop);
  return backdrop;
}

let activeNotificationCenter=null;
document.addEventListener("click",async event=>{
  const bell=event.target.closest?.('button[aria-label="Benachrichtigungen"]');
  if(bell){
    event.preventDefault();
    activeNotificationCenter=notificationCenter();
    return;
  }
  const target=event.target.closest?.("[data-production-action]");
  if(!target)return;
  const action=target.dataset.productionAction;
  if(action==="request-reset"){event.preventDefault();resetRequestModal();return}
  if(action==="support"){event.preventDefault();supportRequestModal();return}
  if(action==="privacy"){event.preventDefault();privacyModal();return}
  if(action==="admin-view"){
    S.adminView=target.dataset.view;
    activeNotificationCenter?.remove();
    activeNotificationCenter=null;
    renderAdmin();
    return;
  }
  if(action==="mark-all-read"){
    target.disabled=true;
    try{
      const unread=employeeNotificationRows().filter(item=>item.read!==true);
      for(const note of unread){
        await uCall("markNotificationRead",{notificationId:note.id});
        note.read=true;
        note.read_at=new Date().toISOString();
      }
      renderEmployee();
      await renderNotificationCenter(activeNotificationCenter);
    }catch(error){toast(error.message,"error");target.disabled=false}
    return;
  }
  if(action==="approve-reset"){
    target.disabled=true;
    try{
      const result=await productionCall("approveReset",{token:S.session?.token,requestId:target.dataset.id});
      activeNotificationCenter?.remove();activeNotificationCenter=null;
      resetDeliveryModal(result.delivery);
    }catch(error){toast(error.message,"error");target.disabled=false}
    return;
  }
  if(action==="cancel-reset"){
    target.disabled=true;
    try{await productionCall("cancelReset",{token:S.session?.token,requestId:target.dataset.id});await renderNotificationCenter(activeNotificationCenter)}
    catch(error){toast(error.message,"error");target.disabled=false}
    return;
  }
  if(action==="close-support"){
    target.disabled=true;
    try{await productionCall("closeSupport",{token:S.session?.token,requestId:target.dataset.id});await renderNotificationCenter(activeNotificationCenter)}
    catch(error){toast(error.message,"error");target.disabled=false}
  }
});
