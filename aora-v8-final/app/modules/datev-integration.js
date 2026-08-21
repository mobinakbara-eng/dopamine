"use strict";

(function initDatevIntegration(){
  const DATEV_FUNCTION=window.__AORA_RUNTIME_CONFIG__?.functions?.datev||"aora-v8-datev-integration";
  const DATEV_CONNECTED_APPS_URL="https://apps.datev.de/tokrevui";
  const DATEV_HELP_URL="https://developer.datev.de/de/product-detail/hr-exchange/1.0.0/overview";
  const DATEV_ENVIRONMENT="sandbox";
  const DATEV_SERVICE="hr_exchange";
  const ui={loading:false,loaded:false,error:null,preflight:null,status:null};

  function enabled(){
    return CFG.environment!=="production"&&typeof isOwner==="function"&&isOwner();
  }

  async function datevRequest(body){
    const token=String(S.session?.token||"");
    if(!token)throw Object.assign(new Error("Aora-Sitzung fehlt."),{status:401});
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(`${CFG.url}/functions/v1/${DATEV_FUNCTION}`,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${token}`
        },
        body:JSON.stringify(body),
        signal:controller.signal
      });
      const text=await response.text();
      let payload={};
      try{payload=text?JSON.parse(text):{}}catch{payload={message:text}}
      if(!response.ok||payload.ok===false){
        const error=new Error(payload.message||payload.error||`HTTP ${response.status}`);
        error.status=response.status;
        error.code=payload.error||"datev_request_failed";
        throw error;
      }
      return payload.result??payload;
    }catch(error){
      if(error?.name==="AbortError")throw Object.assign(new Error("DATEV-Anfrage hat zu lange gedauert."),{status:408});
      throw error;
    }finally{
      clearTimeout(timeout);
    }
  }

  function connection(){return ui.status?.connection||null}
  function configured(){return Boolean(ui.status?.configured)}
  function connected(){return connection()?.status==="connected"}
  function missingConfig(){return Array.isArray(ui.preflight?.missing)?ui.preflight.missing:[]}
  function text(value,fallback="–"){const result=String(value??"").trim();return esc(result||fallback)}
  function displayDate(value){
    if(!value)return"–";
    const date=new Date(value);
    return Number.isFinite(date.getTime())?date.toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"}):"–";
  }

  function statusLabel(){
    if(ui.loading)return["Wird geprüft","pending"];
    if(ui.error)return["Prüfung fehlgeschlagen","error"];
    if(connected())return["Verbunden","connected"];
    if(configured())return["Konfiguriert","pending"];
    return["Nicht eingerichtet","idle"];
  }

  function readinessRows(){
    const preflight=ui.preflight;
    const rows=[
      ["AORA Backend",true,"OAuth, Token-Speicher und Mandantenprüfung vorbereitet"],
      ["Developer-Portal Credentials",Boolean(preflight?.credentialsReady),preflight?.credentialsReady?"Server-Credentials vorhanden; API-Subscription separat im DATEV Developer Portal prüfen":"Client ID / Secret / Redirect noch extern zu konfigurieren"],
      ["hr:exchange Subscription",false,"Wird erst nach bestätigtem DATEV-Onboarding/Subscription als bereit markiert"],
      ["hr:exchange Schreibtransport",Boolean(preflight?.writeTransportReady),preflight?.writeTransportReady?"Freigeschaltet":"Bleibt bis zum abonnierten OpenAPI-Vertrag bewusst gesperrt"],
      ["DATEV Partnerstatus",false,"Noch kein Partnerstatus – diese Ansicht behauptet keine DATEV-Partnerschaft"]
    ];
    return rows.map(([label,ok,detail])=>`<div class="datev-readiness-row"><span class="datev-dot ${ok?"ok":""}" aria-hidden="true"></span><div><strong>${esc(label)}</strong><small>${esc(detail)}</small></div></div>`).join("");
  }

  function missingBlock(){
    const missing=missingConfig();
    if(!missing.length)return"";
    return `<div class="datev-alert"><strong>Für den ersten Sandbox-Connect fehlt noch:</strong><ul>${missing.map(item=>`<li>${esc(item)}</li>`).join("")}</ul><small>Secrets niemals im Browser oder in Aora-Einstellungen eingeben. Sie gehören ausschließlich in die Server-Konfiguration.</small></div>`;
  }

  function connectionBlock(){
    const row=connection();
    if(!row)return`<div class="datev-empty">Noch kein DATEV-Datenbestand für hr:exchange konfiguriert.</div>`;
    return `<dl class="datev-meta">
      <div><dt>Datenbestand</dt><dd>${text(row.datevClientId)}</dd></div>
      <div><dt>Lohnprogramm</dt><dd>${row.payrollSystem==="datev_lohn_gehalt"?"DATEV Lohn und Gehalt":"DATEV LODAS"}</dd></div>
      <div><dt>Token-Modus</dt><dd>${row.tokenMode==="long"?"Langzeitverbindung":"Kurzzeitverbindung"}</dd></div>
      <div><dt>Verbunden durch</dt><dd>${text(row.issuerName,"Noch nicht verbunden")}</dd></div>
      <div><dt>Verbindung gültig bis</dt><dd>${esc(displayDate(row.refreshTokenExpiresAt))}</dd></div>
      <div><dt>Letzte Berechtigungsprüfung</dt><dd>${esc(displayDate(row.lastAccessCheckAt))}</dd></div>
    </dl>`;
  }

  function controls(){
    if(ui.loading)return'<button class="btn outline" disabled>DATEV wird geprüft …</button>';
    if(connected())return`<button class="btn outline" data-datev-action="access-check">Verbindung prüfen</button><button class="btn light" data-datev-action="disconnect">Verbindung trennen</button>`;
    if(configured())return`<button class="btn" data-datev-action="connect" ${missingConfig().length?"disabled":""}>Mit DATEV verbinden</button><button class="btn outline" data-datev-action="refresh">Status prüfen</button>`;
    return'<button class="btn outline" data-datev-action="refresh">Voraussetzungen prüfen</button>';
  }

  function setupForm(){
    const row=connection();
    const disabled=connected()?"disabled":"";
    return `<form class="datev-setup-form" id="datev-setup-form">
      <div class="form-grid">
        <div class="field"><label for="datev-berater">Beraternummer</label><input class="input" id="datev-berater" name="beraterNumber" inputmode="numeric" pattern="[0-9]{4,7}" minlength="4" maxlength="7" autocomplete="off" value="${text(row?.beraterNumber,"")}" ${disabled} required></div>
        <div class="field"><label for="datev-mandant">Mandantennummer</label><input class="input" id="datev-mandant" name="mandantNumber" inputmode="numeric" pattern="[0-9]{1,5}" minlength="1" maxlength="5" autocomplete="off" value="${text(row?.mandantNumber,"")}" ${disabled} required></div>
        <div class="field"><label for="datev-payroll-system">Lohnprogramm</label><select class="input" id="datev-payroll-system" name="payrollSystem" ${disabled}><option value="datev_lodas" ${row?.payrollSystem!=="datev_lohn_gehalt"?"selected":""}>DATEV LODAS</option><option value="datev_lohn_gehalt" ${row?.payrollSystem==="datev_lohn_gehalt"?"selected":""}>DATEV Lohn und Gehalt</option></select></div>
        <div class="field"><label for="datev-token-mode">Verbindung</label><select class="input" id="datev-token-mode" name="tokenMode" ${disabled}><option value="long" ${row?.tokenMode!=="short"?"selected":""}>Langzeitverbindung</option><option value="short" ${row?.tokenMode==="short"?"selected":""}>Kurzzeitverbindung</option></select></div>
      </div>
      ${connected()?"":'<div class="datev-form-actions"><button class="btn outline" type="submit">Datenbestand speichern</button></div>'}
    </form>`;
  }

  function cardMarkup(){
    const [label,kind]=statusLabel();
    return `<article class="dashboard-card datev-card" id="datev-integration-card">
      <div class="datev-card-head"><div><div class="caps muted">Lohnvorbereitung · Sandbox</div><h2>DATEV-Anbindung</h2><p>AORA bereitet hr:exchange vor. Partnerstatus oder technische Freigabe werden hier nicht behauptet.</p></div><span class="datev-status ${kind}">${esc(label)}</span></div>
      ${ui.error?`<div class="datev-alert error"><strong>Status konnte nicht geladen werden.</strong><small>${esc(ui.error)}</small></div>`:""}
      ${missingBlock()}
      <div class="datev-layout"><section><h3>Datenbestand</h3>${connectionBlock()}${setupForm()}<div class="datev-actions">${controls()}</div><div class="datev-links"><a href="${DATEV_CONNECTED_APPS_URL}" target="_blank" rel="noopener noreferrer">DATEV Verbundene Anwendungen</a><a href="${DATEV_HELP_URL}" target="_blank" rel="noopener noreferrer">hr:exchange Dokumentation</a></div></section><section><h3>Freigabe-Readiness</h3><div class="datev-readiness">${readinessRows()}</div></section></div>
    </article>`;
  }

  function settingsSection(){
    if(!enabled())return"";
    queueMicrotask(()=>{if(!ui.loaded&&!ui.loading)refresh()});
    return cardMarkup();
  }

  function replaceCard(){
    const current=document.getElementById("datev-integration-card");
    if(!current||!enabled())return;
    const wrapper=document.createElement("div");
    wrapper.innerHTML=cardMarkup();
    const next=wrapper.firstElementChild;
    if(next)current.replaceWith(next);
  }

  async function refresh(force=false){
    if(!enabled()||ui.loading)return;
    if(ui.loaded&&!force)return;
    ui.loading=true;ui.error=null;replaceCard();
    try{
      const [preflight,status]=await Promise.all([
        datevRequest({action:"preflight",service:DATEV_SERVICE,environment:DATEV_ENVIRONMENT}),
        datevRequest({action:"status",service:DATEV_SERVICE,environment:DATEV_ENVIRONMENT})
      ]);
      ui.preflight=preflight;ui.status=status;ui.loaded=true;
    }catch(error){
      ui.error=error?.message||"Unbekannter DATEV-Fehler";
      ui.loaded=true;
    }finally{
      ui.loading=false;replaceCard();
    }
  }

  async function configure(form){
    const data=new FormData(form);
    const beraterNumber=String(data.get("beraterNumber")||"").trim();
    const mandantNumber=String(data.get("mandantNumber")||"").trim();
    if(!/^\d{4,7}$/.test(beraterNumber))throw new Error("Beraternummer muss 4 bis 7 Ziffern haben.");
    if(!/^\d{1,5}$/.test(mandantNumber))throw new Error("Mandantennummer muss 1 bis 5 Ziffern haben.");
    await datevRequest({
      action:"configure_connection",
      service:DATEV_SERVICE,
      environment:DATEV_ENVIRONMENT,
      beraterNumber,
      mandantNumber,
      payrollSystem:String(data.get("payrollSystem")||"datev_lodas"),
      tokenMode:String(data.get("tokenMode")||"long")
    });
    ui.loaded=false;
    await refresh(true);
    toast("DATEV-Datenbestand wurde für die Sandbox vorbereitet.","success");
  }

  async function connect(){
    const result=await datevRequest({action:"oauth_start",service:DATEV_SERVICE,environment:DATEV_ENVIRONMENT});
    const target=new URL(result.authorizationUrl);
    if(target.protocol!=="https:"||!(target.hostname==="login.datev.de"||target.hostname.endsWith(".datev.de")))throw new Error("Unerwartete DATEV-Anmeldeadresse.");
    location.assign(target.href);
  }

  async function accessCheck(){
    await datevRequest({action:"access_check",service:DATEV_SERVICE,environment:DATEV_ENVIRONMENT});
    ui.loaded=false;await refresh(true);toast("DATEV-Berechtigung wurde erfolgreich geprüft.","success");
  }

  async function disconnect(){
    if(!confirm("DATEV-Verbindung wirklich trennen? Die Tokens werden bei DATEV widerrufen und lokal entfernt."))return;
    await datevRequest({action:"disconnect",service:DATEV_SERVICE,environment:DATEV_ENVIRONMENT});
    ui.loaded=false;await refresh(true);toast("DATEV-Verbindung wurde getrennt.","success");
  }

  const originalSettingsPage=typeof settingsPage==="function"?settingsPage:null;
  if(originalSettingsPage){
    settingsPage=function datevAwareSettingsPage(){return originalSettingsPage()+settingsSection()};
  }

  app.addEventListener("submit",async event=>{
    if(event.target?.id!=="datev-setup-form")return;
    event.preventDefault();
    const button=event.target.querySelector('button[type="submit"]');
    if(button)button.disabled=true;
    try{await configure(event.target)}catch(error){toast(error.message||"DATEV-Konfiguration fehlgeschlagen.","error")}finally{if(button?.isConnected)button.disabled=false}
  });

  app.addEventListener("click",async event=>{
    const button=event.target.closest("[data-datev-action]");
    if(!button||!enabled())return;
    const action=button.dataset.datevAction;
    button.disabled=true;
    try{
      if(action==="refresh")await refresh(true);
      else if(action==="connect")await connect();
      else if(action==="access-check")await accessCheck();
      else if(action==="disconnect")await disconnect();
    }catch(error){toast(error.message||"DATEV-Aktion fehlgeschlagen.","error")}finally{if(button.isConnected)button.disabled=false}
  });

  const callback=new URLSearchParams(location.search);
  if(callback.get("datev")==="connected"){
    queueMicrotask(()=>toast("DATEV-Verbindung wurde bestätigt. Aora prüft jetzt den Datenbestand.","success"));
    callback.delete("datev");callback.delete("service");
    const clean=`${location.pathname}${callback.toString()?`?${callback}`:""}${location.hash}`;
    history.replaceState({},"",clean);
    ui.loaded=false;
  }
})();
