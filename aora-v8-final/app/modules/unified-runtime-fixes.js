"use strict";

if(typeof CFG!=="undefined")CFG.domainFunction="aora-v8-domain-api-compat";

// The legacy offline module may already have registered /sw.js. Reuse that registration
// and configure it instead of creating an immediately waiting worker with a second URL.
if(typeof globalThis.uRegisterWorker==="function"){
  globalThis.uRegisterWorker=async function(){
    if(!("serviceWorker"in navigator))return null;
    const registration=typeof globalThis.ensureWorker==="function"
      ?await globalThis.ensureWorker()
      :await navigator.serviceWorker.getRegistration("/");
    if(!registration)return null;
    if(registration.waiting&&navigator.serviceWorker.controller)globalThis.uShowUpdate?.(registration);
    registration.addEventListener("updatefound",()=>registration.installing?.addEventListener("statechange",()=>{
      if(registration.waiting&&navigator.serviceWorker.controller)globalThis.uShowUpdate?.(registration);
    }));
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(!globalThis.uHasUnsafeWork?.())location.reload();
    },{once:true});
    return registration;
  };
}

if(typeof globalThis.uShowUpdate==="function"){
  globalThis.uShowUpdate=function(registration){
    if(document.querySelector(".u-update-banner"))return;
    const banner=document.createElement("div");
    banner.className="u-update-banner";
    banner.setAttribute("role","status");
    banner.innerHTML='<span>Neue Version verfügbar</span><button type="button">Aktualisieren</button>';
    banner.querySelector("button").addEventListener("click",()=>{
      if(globalThis.uHasUnsafeWork?.()){
        toast("Bitte laufende Eingaben oder Uploads zuerst abschließen.","warning");
        return;
      }
      registration.waiting?.postMessage({type:"AORA_ACTIVATE_UPDATE"});
    });
    document.body.appendChild(banner);
  };
}
