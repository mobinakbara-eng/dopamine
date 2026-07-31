"use strict";

const aoraLegacyEnsureWorker=typeof ensureWorker==="function"?ensureWorker:null;
ensureWorker=async function(){
  if(!("serviceWorker"in navigator))return null;
  const query=new URLSearchParams({supabase:CFG.url,kioskFunction:CFG.kioskWorkspaceFunction});
  const registration=await navigator.serviceWorker.register(`/sw.js?${query}`,{updateViaCache:"none"});
  await navigator.serviceWorker.ready;
  const worker=registration.active||registration.waiting||registration.installing||navigator.serviceWorker.controller;
  worker?.postMessage({type:"AORA_CONFIG",supabaseUrl:CFG.url,kioskFunction:CFG.kioskWorkspaceFunction});
  return registration;
};
const aoraLegacyBindOfflinePunchSession=typeof bindOfflinePunchSession==="function"?bindOfflinePunchSession:null;
if(aoraLegacyBindOfflinePunchSession){
  bindOfflinePunchSession=async function(session){
    const result=await aoraLegacyBindOfflinePunchSession(session);
    const registration=await ensureWorker();
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
      if(url.searchParams.get("task")){S.employeeView="tasks";S.u&&(S.u.tasks.selected=url.searchParams.get("task"));render()}
    }
  });
}
