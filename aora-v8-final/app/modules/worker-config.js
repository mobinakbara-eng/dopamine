"use strict";

const aoraLegacyEnsureWorker=typeof globalThis.ensureWorker==="function"?globalThis.ensureWorker:null;
globalThis.ensureWorker=async function(){
  if(!("serviceWorker"in navigator))return null;
  let registration=await navigator.serviceWorker.getRegistration("/");
  if(!registration)registration=await navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"});
  await navigator.serviceWorker.ready;
  const worker=registration.active||registration.waiting||registration.installing||navigator.serviceWorker.controller;
  worker?.postMessage({type:"AORA_CONFIG",supabaseUrl:CFG.url,kioskFunction:CFG.kioskWorkspaceFunction});
  return registration;
};
const aoraLegacyBindOfflinePunchSession=typeof globalThis.bindOfflinePunchSession==="function"?globalThis.bindOfflinePunchSession:null;
if(aoraLegacyBindOfflinePunchSession){
  globalThis.bindOfflinePunchSession=async function(session){
    const result=await aoraLegacyBindOfflinePunchSession(session);
    const registration=await globalThis.ensureWorker();
    const worker=registration?.active||registration?.waiting||registration?.installing||navigator.serviceWorker.controller;
    worker?.postMessage({type:"AORA_CONFIG",supabaseUrl:CFG.url,kioskFunction:CFG.kioskWorkspaceFunction});
    return result;
  };
}
if("serviceWorker"in navigator){
  navigator.serviceWorker.addEventListener("message",event=>{
    if(event.data?.type==="AORA_UPDATE_BLOCKED"){
      toast(`Update wartet: ${Number(event.data.pending||0)} Offline-Buchung(en) müssen zuerst synchronisiert werden.`,"warning");
    }
    if(event.data?.type==="AORA_NOTIFICATION_OPEN"&&event.data.url){
      const url=new URL(event.data.url,location.origin);
      history.pushState({},"",`${url.pathname}${url.search}`);
      if(url.searchParams.get("task")){
        S.employeeView="tasks";
        if(S.u)S.u.tasks.selected=url.searchParams.get("task");
        render();
      }
    }
  });
}
