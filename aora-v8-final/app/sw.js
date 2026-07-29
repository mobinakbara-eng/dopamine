"use strict";

const DB_NAME="aora-pilot-offline";
const DB_VERSION=2;
const QUEUE="offline_punch_queue";
const KEYS="device_keys";
const SESSIONS="device_sessions";
const SYNC_TAG="aora-punch-sync";
const ENDPOINT="https://xqgkawskftzurbujrpex.supabase.co/functions/v1/aora-v8-pilot-kiosk";

self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("sync",event=>{if(event.tag===SYNC_TAG)event.waitUntil(syncQueue())});
self.addEventListener("message",event=>{if(event.data?.type==="AORA_SYNC_PUNCHES")event.waitUntil(syncQueue())});

function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(QUEUE)){
        const queue=db.createObjectStore(QUEUE,{keyPath:"eventId"});
        queue.createIndex("byKeyId","keyId",{unique:false});
        queue.createIndex("byStatus","status",{unique:false});
        queue.createIndex("byCreatedAt","createdAt",{unique:false});
      }
      if(!db.objectStoreNames.contains(KEYS))db.createObjectStore(KEYS,{keyPath:"keyId"});
      if(!db.objectStoreNames.contains(SESSIONS))db.createObjectStore(SESSIONS,{keyPath:"keyId"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function get(storeName,key){const db=await openDb();const tx=db.transaction(storeName,"readonly");return requestResult(tx.objectStore(storeName).get(key))}
async function all(storeName){const db=await openDb();const tx=db.transaction(storeName,"readonly");return requestResult(tx.objectStore(storeName).getAll())}
async function put(storeName,value){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,"readwrite");tx.objectStore(storeName).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
async function remove(storeName,key){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,"readwrite");tx.objectStore(storeName).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
function aad(record,purpose,eventId=""){return new TextEncoder().encode(`aora|${record.organizationId}|${record.deviceId}|${purpose}|${eventId}`)}
async function decrypt(key,record,additionalData){const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(record.iv),additionalData},key,record.ciphertext);return JSON.parse(new TextDecoder().decode(plaintext))}
async function notify(eventId,data){const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});for(const client of clients)client.postMessage({type:"AORA_PUNCH_SYNCED",eventId,data})}
async function updateFailure(record,error){await put(QUEUE,{...record,status:"pending",retryCount:Number(record.retryCount||0)+1,lastError:String(error?.message||error),updatedAt:Date.now()})}

async function syncRecord(record){
  const keyRecord=await get(KEYS,record.keyId);
  const sessionRecord=await get(SESSIONS,record.keyId);
  if(!keyRecord?.key||!sessionRecord)throw new Error("Geräteschlüssel oder Kiosk-Sitzung fehlt.");
  const event=await decrypt(keyRecord.key,record,aad(record,"punch",record.eventId));
  const session=await decrypt(keyRecord.key,sessionRecord,aad(sessionRecord,"session"));
  if(session.expiresAt&&new Date(session.expiresAt)<=new Date())throw new Error("Kiosk-Sitzung ist abgelaufen.");
  await put(QUEUE,{...record,status:"syncing",updatedAt:Date.now()});
  const response=await fetch(ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify({action:"apply",token:session.token,event})});
  const text=await response.text();
  let data;
  try{data=text?JSON.parse(text):{}}catch{data={error:text}}
  if(!response.ok){const error=new Error(data.error||`HTTP ${response.status}`);error.status=response.status;throw error}
  if(data.pending){await put(QUEUE,{...record,status:"pending",lastError:data.message||"Verarbeitung läuft",updatedAt:Date.now()});return false}
  await remove(QUEUE,record.eventId);
  await notify(record.eventId,data);
  return true;
}
async function syncQueue(){
  const records=(await all(QUEUE)).sort((a,b)=>a.createdAt-b.createdAt);
  for(const record of records){
    try{await syncRecord(record)}catch(error){await updateFailure(record,error);if(!self.navigator.onLine||Number(error?.status)>=500||[408,425,429].includes(Number(error?.status)))throw error}
  }
}