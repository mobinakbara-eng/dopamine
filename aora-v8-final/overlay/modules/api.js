"use strict";

const REQUEST_TIMEOUT_MS=15000;
const PUNCH_PENDING_TTL_MS=15*60*1000;

async function request(functionName,body){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(`${CFG.url}/functions/v1/${functionName}`,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify(body),
      signal:controller.signal
    });
    const text=await response.text();
    let data;
    try{data=text?JSON.parse(text):{}}catch{data={error:text}}
    if(!response.ok){
      const error=new Error(data.error||data.message||`HTTP ${response.status}`);
      error.status=response.status;
      error.data=data;
      throw error;
    }
    return data;
  }catch(error){
    if(error?.name==="AbortError"){
      const timeoutError=new Error("Die Verbindung dauert zu lange. Bitte nicht erneut stempeln; Aora prÃ¼ft die Buchung automatisch.");
      timeoutError.status=408;
      timeoutError.retryable=true;
      throw timeoutError;
    }
    if(error instanceof TypeError){
      const networkError=new Error("Aora konnte den Server nicht erreichen. Die Buchung wird verschlÃ¼sselt gespeichert und mit derselben event_id erneut gesendet.");
      networkError.status=503;
      networkError.retryable=true;
      throw networkError;
    }
    throw error;
  }finally{
    clearTimeout(timeout);
  }
}
async function access(body){return request(CFG.accessFunction,body)}
async function workspace(body){
  const functionName=S.accessRole==="kiosk"?CFG.kioskWorkspaceFunction:CFG.workspaceFunction;
  return request(functionName,{...body,token:S.session?.token});
}

function key(accessRole=S.accessRole){return`aora:${CFG.slug}:${accessRole}`}
function save(){if(S.session)sessionStorage.setItem(key(S.accessRole),JSON.stringify(S.session))}
function restore(accessRole=S.accessRole){
  try{return JSON.parse(sessionStorage.getItem(key(accessRole))||"null")}catch{return null}
}
function clearSessions(){
  for(const role of ["owner","manager","employee","kiosk"])sessionStorage.removeItem(key(role));
}
function activateSession(session,fallbackRole){
  S.session=session;
  S.role=session.role;
  S.accessRole=session.accessRole||fallbackRole||session.role;
  S.loginRole=S.accessRole;
  save();
  if(S.accessRole==="kiosk"&&typeof bindOfflinePunchSession==="function")bindOfflinePunchSession(S.session).catch(error=>console.warn("Offline session binding failed",error));
  history.replaceState({},"",accessPath(S.accessRole));
}

function punchStorageKey(event){
  const tenant=S.session?.organizationId||CFG.slug;
  const device=S.session?.deviceId||S.session?.subjectId||"kiosk";
  return`aora:punch:${tenant}:${device}:${event.employeeId||"unknown"}:${event.target||"unknown"}`;
}
function readPendingPunch(storageKey){
  try{
    const value=JSON.parse(sessionStorage.getItem(storageKey)||"null");
    if(!value?.eventId||Date.now()-Number(value.createdAt||0)>PUNCH_PENDING_TTL_MS){
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return value;
  }catch{
    sessionStorage.removeItem(storageKey);
    return null;
  }
}
function preparePunchEvent(event){
  if(event?.type!=="KIOSK_TRANSITION")return{event,storageKey:null};
  const storageKey=punchStorageKey(event);
  const pending=readPendingPunch(storageKey);
  const eventId=pending?.eventId||crypto.randomUUID();
  const clientCreatedAt=pending?.clientCreatedAt||new Date().toISOString();
  const value={
    ...event,
    eventId,
    clientCreatedAt,
    clientTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone||CFG.tz,
    deviceClockOffset:new Date().getTimezoneOffset()
  };
  sessionStorage.setItem(storageKey,JSON.stringify({eventId,clientCreatedAt,createdAt:pending?.createdAt||Date.now()}));
  return{event:value,storageKey};
}
function clearPendingPunch(storageKey){if(storageKey)sessionStorage.removeItem(storageKey)}
function retryablePunchError(error){
  if(error?.retryable===true)return true;
  if([408,425,429,500,502,503,504].includes(Number(error?.status)))return true;
  return Number(error?.status)===409&&/bereits verarbeitet|ParallelÃ¤nderung/i.test(String(error?.message||""));
}

async function loadDirectory(){S.directory=await access({action:"directory",workspaceSlug:CFG.slug})}
async function ensureDirectory(accessRole=S.loginRole){
  if(accessRole!=="kiosk")return;
  if(S.directory)return;
  await loadDirectory();
}

async function login(loginRole,subjectId,pin){
  if(loginRole!=="kiosk")throw Object.assign(new Error("PIN-Anmeldung ist nur fÃ¼r lokale Kiosk-GerÃ¤te verfÃ¼gbar."),{status:403});
  const session=await access({action:"login",workspaceSlug:CFG.slug,role:loginRole,subjectId,pin});
  activateSession(session,loginRole);
  await loadState();
}

async function passwordLogin(email,password){
  const session=await access({action:"passwordLogin",email,password});
  activateSession(session,session.accessRole);
  await loadState();
}

async function inspectInvitation(invitationId,token){return access({action:"inspectInvitation",invitationId,token})}

async function acceptInvitation(invitationId,token,email,password){
  const session=await access({action:"acceptInvitation",invitationId,token,email,password});
  activateSession(session,session.accessRole);
  await loadState();
}

async function logout(){
  const previousSession=S.session;
  try{previousSession?.token&&await access({action:"logout",token:previousSession.token})}catch{}
  if(previousSession?.role==="kiosk"&&typeof unbindOfflinePunchSession==="function")await unbindOfflinePunchSession(previousSession).catch(()=>{});
  clearSessions();
  S.session=null;
  S.state=null;
  S.directory=null;
  history.replaceState({},"",accessPath(S.accessRole));
  try{await ensureDirectory(S.accessRole);renderLogin()}catch(error){renderError(error.message)}
}

async function loadState(quiet=false){
  if(!quiet)renderLoading();
  try{
    const data=await workspace({action:"load"});
    S.state=data.state;
    S.revision=data.revision;
    S.session={...S.session,...data.session,token:S.session.token};
    S.role=S.session.role;
    S.accessRole=S.session.accessRole||S.accessRole;
    S.loginRole=S.accessRole;
    const permitted=S.session.locationIds||[];
    S.locationId=(S.locationId&&S.state.locations?.some(location=>location.id===S.locationId))
      ?S.locationId
      :(S.session.locationId||permitted[0]||S.state.locations?.find(location=>location.active!==false)?.id||null);
    save();
    if(S.accessRole==="kiosk"&&typeof bindOfflinePunchSession==="function")await bindOfflinePunchSession(S.session).catch(()=>{});
    const menuWasOpen=quiet&&document.getElementById("aside")?.classList.contains("open");
    render();
    if(menuWasOpen)document.getElementById("aside")?.classList.add("open");
    if(S.accessRole==="kiosk"&&typeof syncOfflinePunchQueue==="function")syncOfflinePunchQueue().catch(()=>{});
  }catch(error){
    if(error.status===401||error.status===403){
      clearSessions();
      S.session=null;
      S.state=null;
      S.directory=null;
      try{await ensureDirectory(S.accessRole);renderLogin()}catch(directoryError){renderError(directoryError.message)}
      toast(error.message||"Sitzung abgelaufen.","error");
    }else{
      toast(error.message,"error");
      renderError(error.message);
    }
  }
}

async function apply(event){
  if(S.busy){
    const busyError=new Error("Eine Aktion wird bereits verarbeitet.");
    busyError.status=409;
    throw busyError;
  }
  const prepared=preparePunchEvent(event);
  S.busy=true;
  try{
    if(prepared.storageKey&&typeof enqueueOfflinePunch==="function")await enqueueOfflinePunch(prepared.event);
    const data=await workspace({action:"apply",event:prepared.event,expectedRevision:S.revision});
    if(data.pending){
      toast(data.message||"Die Buchung wird bereits verarbeitet.","warning");
      return data;
    }
    if(data.state)S.state=data.state;
    if(data.revision!==undefined)S.revision=data.revision;
    if(prepared.storageKey&&typeof resolveOfflinePunch==="function")await resolveOfflinePunch(prepared.event.eventId);
    clearPendingPunch(prepared.storageKey);
    render();
    if(data.idempotentReplay)toast("Diese Aktion wurde bereits gespeichert.","success");
    return data;
  }catch(error){
    if(prepared.storageKey){
      if(retryablePunchError(error)&&typeof markOfflinePunchPending==="function")await markOfflinePunchPending(prepared.event.eventId,error).catch(()=>{});
      else if(typeof resolveOfflinePunch==="function")await resolveOfflinePunch(prepared.event.eventId).catch(()=>{});
      if(!retryablePunchError(error))clearPendingPunch(prepared.storageKey);
    }
    if(error.status===409){
      toast(error.message||"Daten wurden aktualisiert. Bitte erneut versuchen.","error");
      await loadState(true);
    }else toast(error.message,"error");
    throw error;
  }finally{
    S.busy=false;
  }
}

