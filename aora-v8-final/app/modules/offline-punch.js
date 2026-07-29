"use strict";

const OFFLINE_DB_NAME="aora-pilot-offline";
const OFFLINE_DB_VERSION=2;
const OFFLINE_SYNC_TAG="aora-punch-sync";
const OFFLINE_QUEUE_STORE="offline_punch_queue";
const OFFLINE_KEY_STORE="device_keys";
const OFFLINE_SESSION_STORE="device_sessions";
let offlineDbPromise=null;
let offlineSyncRunning=false;

function openOfflineDb(){
  if(offlineDbPromise)return offlineDbPromise;
  offlineDbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(OFFLINE_DB_NAME,OFFLINE_DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)){
        const queue=db.createObjectStore(OFFLINE_QUEUE_STORE,{keyPath:"eventId"});
        queue.createIndex("byKeyId","keyId",{unique:false});
        queue.createIndex("byStatus","status",{unique:false});
        queue.createIndex("byCreatedAt","createdAt",{unique:false});
      }
      if(!db.objectStoreNames.contains(OFFLINE_KEY_STORE))db.createObjectStore(OFFLINE_KEY_STORE,{keyPath:"keyId"});
      if(!db.objectStoreNames.contains(OFFLINE_SESSION_STORE))db.createObjectStore(OFFLINE_SESSION_STORE,{keyPath:"keyId"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Offline-Datenbank konnte nicht geöffnet werden."));
  });
  return offlineDbPromise;
}

function idbRequest(request){
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("IndexedDB-Anfrage fehlgeschlagen."));
  });
}
async function withStore(storeName,mode,callback){
  const db=await openOfflineDb();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode);
    const store=transaction.objectStore(storeName);
    let result;
    try{result=callback(store)}catch(error){reject(error);return}
    transaction.oncomplete=()=>resolve(result);
    transaction.onerror=()=>reject(transaction.error||new Error("IndexedDB-Transaktion fehlgeschlagen."));
    transaction.onabort=()=>reject(transaction.error||new Error("IndexedDB-Transaktion wurde abgebrochen."));
  });
}
function offlineContext(session=S.session){
  if(!session||session.role!=="kiosk"||!session.organizationId||!session.deviceId)throw new Error("Aktive Kiosk-Sitzung erforderlich.");
  const keyId=`${session.organizationId}:${session.deviceId}`;
  return{keyId,organizationId:String(session.organizationId),deviceId:String(session.deviceId)};
}
function aad(context,purpose,eventId=""){
  return new TextEncoder().encode(`aora|${context.organizationId}|${context.deviceId}|${purpose}|${eventId}`);
}
async function getDeviceKey(context){
  const existing=await withStore(OFFLINE_KEY_STORE,"readonly",store=>idbRequest(store.get(context.keyId)));
  if(existing?.key)return existing.key;
  const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  await withStore(OFFLINE_KEY_STORE,"readwrite",store=>store.put({keyId:context.keyId,key,createdAt:Date.now(),algorithm:"AES-GCM-256",extractable:false}));
  return key;
}
async function encryptJson(key,value,additionalData){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encoded=new TextEncoder().encode(JSON.stringify(value));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData},key,encoded);
  return{iv:Array.from(iv),ciphertext};
}
async function decryptJson(key,record,additionalData){
  const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(record.iv),additionalData},key,record.ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function bindOfflinePunchSession(session=S.session){
  if(!session||session.role!=="kiosk"||!session.token)return;
  const context=offlineContext(session);
  const key=await getDeviceKey(context);
  const encrypted=await encryptJson(key,{token:session.token,expiresAt:session.expiresAt||null},aad(context,"session"));
  await withStore(OFFLINE_SESSION_STORE,"readwrite",store=>store.put({
    keyId:context.keyId,organizationId:context.organizationId,deviceId:context.deviceId,
    iv:encrypted.iv,ciphertext:encrypted.ciphertext,updatedAt:Date.now()
  }));
}
async function restoreOfflineKioskSession(){
  const sessions=await withStore(OFFLINE_SESSION_STORE,"readonly",store=>idbRequest(store.getAll()));
  const ordered=(sessions||[]).filter(record=>
    record?.organizationId&&record?.deviceId&&record?.keyId
  ).sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
  for(const record of ordered){
    const context={keyId:record.keyId,organizationId:String(record.organizationId),deviceId:String(record.deviceId)};
    try{
      const keyRecord=await withStore(OFFLINE_KEY_STORE,"readonly",store=>idbRequest(store.get(record.keyId)));
      if(!keyRecord?.key)continue;
      const stored=await decryptJson(keyRecord.key,record,aad(context,"session"));
      if(!stored?.token||String(stored.token).length!==64)continue;
      if(stored.expiresAt&&new Date(stored.expiresAt)<=new Date()){
        await withStore(OFFLINE_SESSION_STORE,"readwrite",store=>store.delete(record.keyId));
        continue;
      }
      return{
        token:stored.token,
        expiresAt:stored.expiresAt||null,
        organizationId:context.organizationId,
        role:"kiosk",
        accessRole:"kiosk",
        subjectId:context.deviceId,
        deviceId:context.deviceId
      };
    }catch{}
  }
  return null;
}
async function unbindOfflinePunchSession(session=S.session){
  if(!session||session.role!=="kiosk"||!session.organizationId||!session.deviceId)return;
  const context=offlineContext(session);
  await withStore(OFFLINE_SESSION_STORE,"readwrite",store=>store.delete(context.keyId));
}
async function enqueueOfflinePunch(event){
  if(event?.type!=="KIOSK_TRANSITION")return null;
  const context=offlineContext();
  const existing=await withStore(OFFLINE_QUEUE_STORE,"readonly",store=>idbRequest(store.get(event.eventId)));
  if(existing)return existing;
  const key=await getDeviceKey(context);
  const encrypted=await encryptJson(key,event,aad(context,"punch",event.eventId));
  const record={
    eventId:event.eventId,keyId:context.keyId,organizationId:context.organizationId,deviceId:context.deviceId,
    iv:encrypted.iv,ciphertext:encrypted.ciphertext,createdAt:Date.now(),updatedAt:Date.now(),retryCount:0,
    status:"pending",lastError:null
  };
  await withStore(OFFLINE_QUEUE_STORE,"readwrite",store=>store.add(record));
  await bindOfflinePunchSession();
  await registerOfflineSync();
  renderOfflinePunchStatus().catch(()=>{});
  return record;
}
async function listOfflinePunches(keyId=null){
  const records=await withStore(OFFLINE_QUEUE_STORE,"readonly",store=>idbRequest(store.getAll()));
  return(records||[]).filter(record=>!keyId||record.keyId===keyId).sort((a,b)=>a.createdAt-b.createdAt);
}
async function updateOfflinePunch(eventId,patch){
  const existing=await withStore(OFFLINE_QUEUE_STORE,"readonly",store=>idbRequest(store.get(eventId)));
  if(!existing)return;
  await withStore(OFFLINE_QUEUE_STORE,"readwrite",store=>store.put({...existing,...patch,updatedAt:Date.now()}));
  renderOfflinePunchStatus().catch(()=>{});
}
async function markOfflinePunchPending(eventId,error){
  if(!eventId)return;
  await updateOfflinePunch(eventId,{status:"pending",retryCount:undefined,lastError:String(error?.message||error||"Netzwerkfehler")});
  const existing=await withStore(OFFLINE_QUEUE_STORE,"readonly",store=>idbRequest(store.get(eventId)));
  if(existing)await updateOfflinePunch(eventId,{retryCount:Number(existing.retryCount||0)+1});
  await registerOfflineSync();
}
async function resolveOfflinePunch(eventId){
  if(!eventId)return;
  await withStore(OFFLINE_QUEUE_STORE,"readwrite",store=>store.delete(eventId));
  renderOfflinePunchStatus().catch(()=>{});
}
async function inspectOfflineQueue(){
  const records=await listOfflinePunches();
  return records.map(record=>({eventId:record.eventId,keyId:record.keyId,status:record.status,retryCount:record.retryCount,createdAt:record.createdAt,hasCiphertext:record.ciphertext instanceof ArrayBuffer||ArrayBuffer.isView(record.ciphertext),hasPlaintextPayload:Object.prototype.hasOwnProperty.call(record,"payload")||Object.prototype.hasOwnProperty.call(record,"employeeId")||Object.prototype.hasOwnProperty.call(record,"transition")}));
}
async function decryptQueuedPunch(record){
  const keyRecord=await withStore(OFFLINE_KEY_STORE,"readonly",store=>idbRequest(store.get(record.keyId)));
  if(!keyRecord?.key)throw new Error("Geräteschlüssel fehlt.");
  const context={organizationId:record.organizationId,deviceId:record.deviceId};
  return decryptJson(keyRecord.key,record,aad(context,"punch",record.eventId));
}
async function syncOfflinePunchQueue(){
  if(offlineSyncRunning||!navigator.onLine||S.accessRole!=="kiosk"||!S.session?.token)return;
  offlineSyncRunning=true;
  try{
    const context=offlineContext();
    const records=await listOfflinePunches(context.keyId);
    for(const record of records){
      try{
        await updateOfflinePunch(record.eventId,{status:"syncing"});
        const event=await decryptQueuedPunch(record);
        const data=await workspace({action:"apply",event,expectedRevision:S.revision});
        if(data.pending){await updateOfflinePunch(record.eventId,{status:"pending",lastError:data.message||"Verarbeitung läuft"});continue}
        if(data.state)S.state=data.state;
        if(data.revision!==undefined)S.revision=data.revision;
        await resolveOfflinePunch(record.eventId);
      }catch(error){
        await markOfflinePunchPending(record.eventId,error);
        if(!navigator.onLine||Number(error?.status)>=500||[408,425,429].includes(Number(error?.status)))break;
      }
    }
    if(S.state)render();
  }finally{
    offlineSyncRunning=false;
  }
}
async function registerOfflineSync(){
  if(!("serviceWorker"in navigator))return;
  try{
    const registration=await navigator.serviceWorker.ready;
    if("sync"in registration)await registration.sync.register(OFFLINE_SYNC_TAG);
  }catch{}
}
async function renderOfflinePunchStatus(){
  const existing=document.getElementById("aora-offline-status");
  if(S.accessRole!=="kiosk"){existing?.remove();return}
  let count=0;
  try{count=(await listOfflinePunches(offlineContext().keyId)).length}catch{}
  if(!count&&navigator.onLine){existing?.remove();return}
  const banner=existing||document.createElement("div");
  banner.id="aora-offline-status";
  banner.className=`aora-offline-banner ${navigator.onLine?"syncing":"offline"}`;
  banner.setAttribute("role","status");
  banner.innerHTML=navigator.onLine
    ?`<strong>${count} Buchung${count===1?"":"en"} werden synchronisiert …</strong><span>Bitte nicht erneut stempeln.</span>`
    :`<strong>Offline</strong><span>Buchungen werden sicher verschlüsselt auf diesem Gerät gespeichert.${count?` ${count} ausstehend.`:""}</span>`;
  if(!existing)document.body.prepend(banner);
}

window.addEventListener("online",()=>{renderOfflinePunchStatus().catch(()=>{});syncOfflinePunchQueue().catch(()=>{})});
window.addEventListener("offline",()=>renderOfflinePunchStatus().catch(()=>{}));
window.addEventListener("load",async()=>{
  if("serviceWorker"in navigator){
    try{
      await navigator.serviceWorker.register("/sw.js",{scope:"/"});
      navigator.serviceWorker.addEventListener("message",event=>{
        if(event.data?.type==="AORA_PUNCH_SYNCED"){
          resolveOfflinePunch(event.data.eventId).catch(()=>{});
          if(S.accessRole==="kiosk")loadState(true).catch(()=>{});
        }
      });
    }catch(error){console.warn("Aora service worker registration failed",error)}
  }
  renderOfflinePunchStatus().catch(()=>{});
  syncOfflinePunchQueue().catch(()=>{});
});
