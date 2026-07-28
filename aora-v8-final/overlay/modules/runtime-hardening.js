"use strict";

const AORA_COMPLIANCE_FUNCTION="aora-v8-pilot-compliance-proxy";

request=async function(functionName,body){
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
      const timeoutError=new Error("Die Verbindung dauert zu lange. Bitte den aktuellen Status prüfen, bevor die Aktion wiederholt wird.");
      timeoutError.status=408;timeoutError.retryable=true;throw timeoutError;
    }
    if(error instanceof TypeError){
      const networkError=new Error("Aora konnte den Server nicht erreichen. Die Verbindung wird automatisch erneut geprüft.");
      networkError.status=503;networkError.retryable=true;throw networkError;
    }
    throw error;
  }finally{clearTimeout(timeout)}
};

const aoraBaseAccess=access;
access=function(body){return aoraBaseAccess({workspaceSlug:CFG.slug,...body})};

const AORA_REALTIME_KEYS={
  ADD_SHIFT:["shifts","audit"],UPDATE_SHIFT:["shifts","audit"],REQUEST_LEAVE:["leaveRequests","notifications","audit"],DECIDE_LEAVE:["leaveRequests","notifications","audit"],
  APPROVE_CLOCK_REQUEST:["clockRequests","timeEntries","notifications","audit"],DENY_CLOCK_REQUEST:["clockRequests","notifications","audit"],
  INVITE_MANAGER:["admins","invitations","audit"],CREATE_EMPLOYEE_ACCOUNT:["employees","invitations","audit"],RESEND_INVITATION:["invitations","audit"],REVOKE_INVITATION:["invitations","admins","employees","audit"],
  DEACTIVATE_ACCOUNT:["admins","employees","audit"],ADD_ANNOUNCEMENT:["announcements","audit"],UPDATE_PROFILE:["employees","audit"],CREATE_KIOSK_DEVICE:["kioskDevices","audit"],ROTATE_KIOSK_ACTIVATION:["kioskDevices","audit"],TOGGLE_KIOSK_LOCK:["kioskDevices","audit"],ARCHIVE_LOCATION:["locations","admins","employees","audit"],
  KIOSK_TRANSITION:["clockRequests","notifications","audit"],CORRECTION_REQUESTED:["correctionRequests","compliance"],CORRECTION_DECIDED:["timeEntries","correctionRequests","audit","compliance"],
  EMPLOYEE_ANONYMIZED:["employees","timeEntries","audit","compliance"],INVITATION_ACTIVATED:["admins","invitations","audit"]
};
function notifyWorkspaceRealtime(eventType="WORKSPACE_CHANGED",keys=[],revision=S.revision){
  if(!S.session?.token||!navigator.onLine)return Promise.resolve({skipped:true});
  return request(CFG.realtimeBroadcastFunction,{token:S.session.token,eventType,keys,revision});
}
function scheduleWorkspaceBroadcast(eventType,keys,revision){
  queueMicrotask(()=>notifyWorkspaceRealtime(eventType,keys,revision).catch(error=>reportClientDiagnostic?.("Realtime broadcast failed",error?.stack||String(error),"warning",{kind:"realtime-broadcast",eventType})));
}

async function compliance(body){
  const result=await request(AORA_COMPLIANCE_FUNCTION,{...body,token:S.session?.token});
  const eventByAction={requestCorrection:"CORRECTION_REQUESTED",decideCorrection:"CORRECTION_DECIDED",anonymizeEmployee:"EMPLOYEE_ANONYMIZED",backup:"COMPLIANCE_BACKUP"};
  const eventType=eventByAction[body?.action];
  if(eventType)scheduleWorkspaceBroadcast(eventType,AORA_REALTIME_KEYS[eventType]||["compliance"],result?.result?.next_revision??result?.nextRevision??S.revision);
  return result;
}
async function monitor(body){return request(CFG.monitorFunction,{...body,token:S.session?.token})}
async function downloadCompliance(format,filters={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(`${CFG.url}/functions/v1/${AORA_COMPLIANCE_FUNCTION}`,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({action:"export",format,...filters,token:S.session?.token}),
      signal:controller.signal
    });
    if(!response.ok){
      let message=`HTTP ${response.status}`;
      try{message=(await response.json()).error||message}catch{}
      throw Object.assign(new Error(message),{status:response.status});
    }
    const blob=await response.blob();
    const disposition=response.headers.get("content-disposition")||"";
    const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`aora-${format}`;
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=filename;anchor.hidden=true;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return{filename,checksum:response.headers.get("x-aora-export-checksum")};
  }finally{clearTimeout(timeout)}
}

const aoraBaseApply=apply;
apply=async function(event){
  const result=await aoraBaseApply(event);
  if(!result?.pending){
    const eventType=String(event?.type||"WORKSPACE_CHANGED");
    scheduleWorkspaceBroadcast(eventType,AORA_REALTIME_KEYS[eventType]||[],result?.revision??S.revision);
  }
  return result;
};
const aoraBaseAcceptInvitation=acceptInvitation;
acceptInvitation=async function(...args){
  const result=await aoraBaseAcceptInvitation(...args);
  scheduleWorkspaceBroadcast("INVITATION_ACTIVATED",AORA_REALTIME_KEYS.INVITATION_ACTIVATED,S.revision);
  return result;
};
const aoraBaseLoadState=loadState;
loadState=async function(quiet=false){
  const result=await aoraBaseLoadState(quiet);
  if(S.session)connectWorkspaceRealtime().catch(()=>{});
  return result;
};
const aoraBaseLogout=logout;
logout=async function(){
  await disconnectWorkspaceRealtime().catch(()=>{});
  return aoraBaseLogout();
};
