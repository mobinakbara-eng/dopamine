"use strict";

if(typeof globalThis.uCall==="function"&&typeof globalThis.request==="function"){
  const previousDomainCall=globalThis.uCall;
  const patchActions=new Set([
    "evidenceUpload",
    "confirmEvidence",
    "pushSubscribe",
    "pushUnsubscribe",
    "managerOverride",
    "createShiftSeries"
  ]);
  CFG.domainPatchFunction=window.__AORA_RUNTIME_CONFIG__?.functions?.domainPatch||"aora-v8-domain-patch";

  globalThis.uCall=async function(action,payload={},feature=false){
    if(feature||!patchActions.has(action))return previousDomainCall(action,payload,feature);
    if(!S.session?.token)throw new Error("Sitzung fehlt.");
    const envelope=await request(CFG.domainPatchFunction,{action,token:S.session.token,...payload});
    if(envelope?.error){
      throw Object.assign(new Error(envelope.error.message||"Aktion fehlgeschlagen."),{data:envelope});
    }
    return envelope?.data;
  };
}
