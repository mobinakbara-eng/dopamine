"use strict";

const AORA_SECRET_PATTERN=/\b[0-9a-f]{64}\b/gi;
function redactClientDiagnostic(value){
  return String(value||"")
    .replace(AORA_SECRET_PATTERN,"[REDACTED]")
    .replace(/([?&](?:token|session|key)=)[^&#\s]+/gi,"$1[REDACTED]")
    .slice(0,8000);
}
let lastClientDiagnostic="";
async function reportClientDiagnostic(message,stack="",severity="error",metadata={}){
  const safeMessage=redactClientDiagnostic(message).slice(0,1000);
  if(!safeMessage)return;
  const fingerprint=`${safeMessage}|${redactClientDiagnostic(stack).slice(0,500)}`;
  if(fingerprint===lastClientDiagnostic)return;
  lastClientDiagnostic=fingerprint;
  try{
    await monitor({
      action:"event",
      severity,
      message:safeMessage,
      stack:redactClientDiagnostic(stack),
      url:location.origin+location.pathname,
      buildSha:document.documentElement.dataset.buildSha||CFG.version,
      metadata:{workspace:CFG.slug,accessRole:S.accessRole,syncStatus:S.realtimeStatus,...metadata}
    });
  }catch{}
}
window.addEventListener("error",event=>{
  reportClientDiagnostic(event.message,event.error?.stack||`${event.filename||""}:${event.lineno||0}:${event.colno||0}`,"error",{kind:"window-error"});
});
window.addEventListener("unhandledrejection",event=>{
  const reason=event.reason;
  reportClientDiagnostic(reason?.message||reason,reason?.stack||"","error",{kind:"unhandled-rejection"});
});
