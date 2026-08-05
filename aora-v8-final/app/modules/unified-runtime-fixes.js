"use strict";

if(typeof CFG!=="undefined")CFG.domainFunction="aora-v8-domain-api";

// Task reads and writes must use the compatibility endpoint until the canonical
// API no longer contains ambiguous PostgREST relationships. Keeping the full
// task workflow on one scoped endpoint also prevents read/write authorization
// drift between employee and manager paths.
if(typeof globalThis.uCall==="function"&&typeof globalThis.request==="function"){
  const readActions=new Set(["flags","calendar","scheduleBoard","taskTemplates","taskRules","tasks"]);
  const taskActions=new Set(["tasks","saveTaskAnswer","submitTask","reviewTask"]);
  const inFlight=new Map();
  const cache=new Map();
  const stable=value=>{
    if(Array.isArray(value))return value.map(stable);
    if(value&&typeof value==="object")return Object.keys(value).sort().reduce((out,key)=>(out[key]=stable(value[key]),out),{});
    return value;
  };
  const ttlFor=action=>action==="flags"?60000:["taskTemplates","taskRules"].includes(action)?30000:10000;
  globalThis.uCall=async function(action,payload={},feature=false){
    if(!S.session?.token)throw new Error("Sitzung fehlt.");
    const read=readActions.has(action)&&!feature;
    const functionName=feature?CFG.featureFunction:(taskActions.has(action)?"aora-v8-domain-api-compat":CFG.domainFunction);
    const key=read?JSON.stringify([functionName,action,S.session.subjectId||"",S.locationId||"",stable(payload)]):"";
    const cached=read?cache.get(key):null;
    if(cached&&cached.expires>Date.now())return cached.data;
    if(read&&inFlight.has(key))return inFlight.get(key);
    if(!read)cache.clear();
    const job=(async()=>{
      const envelope=await request(functionName,{action,token:S.session.token,...payload});
      if(envelope?.error)throw Object.assign(new Error(envelope.error.message||"Aktion fehlgeschlagen."),{data:envelope});
      const data=envelope?.data;
      if(read)cache.set(key,{data,expires:Date.now()+ttlFor(action)});
      return data;
    })();
    if(read)inFlight.set(key,job);
    try{return await job}finally{if(read)inFlight.delete(key)}
  };
}

// An empty task list is still a loaded result. The previous length check caused a
// fresh API request on every render when an employee had no tasks.
if(typeof globalThis.uEnsureEmployeeTasks==="function"){
  globalThis.uEnsureEmployeeTasks=async function(force=false){
    if(!uFlag("task_automation"))return;
    const from=uAdd(berlin().date,-14),to=uAdd(berlin().date,45);
    const key=`${S.session?.subjectId||""}:${from}:${to}`;
    if(S.u.tasks.loading)return;
    if(!force&&S.u.tasks.employeeKey===key)return;
    S.u.tasks.loading=true;S.u.tasks.error="";render();
    try{
      S.u.tasks.data=await uCall("tasks",{from,to});
      S.u.tasks.employeeKey=key;
      if(!S.u.tasks.selected&&S.u.tasks.data.length)S.u.tasks.selected=S.u.tasks.data[0].id;
    }catch(error){S.u.tasks.error=uErrorMessage(error)}
    finally{S.u.tasks.loading=false;render()}
  };
}

// Warm the production API connection before the first authenticated request.
if(typeof CFG!=="undefined"&&CFG.url&&document.head&&!document.querySelector('link[data-aora-api-preconnect]')){
  try{
    const origin=new URL(CFG.url).origin;
    const link=document.createElement("link");
    link.rel="preconnect";link.href=origin;link.crossOrigin="anonymous";link.dataset.aoraApiPreconnect="";
    document.head.appendChild(link);
  }catch{}
}

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
