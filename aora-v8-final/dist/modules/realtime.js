"use strict";

let aoraRealtimeClient=null;
let aoraRealtimeChannel=null;
let aoraRealtimeTopic=null;
let aoraFallbackTimer=null;
let aoraRealtimeReconnectTimer=null;
let aoraRealtimeRefreshTimer=null;

async function aoraSha256Hex(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||"")));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}
function setWorkspaceSyncStatus(status){
  S.realtimeStatus=status;
  document.documentElement.dataset.aoraSync=status;
  document.dispatchEvent(new CustomEvent("aora:sync-status",{detail:{status}}));
}
function scheduleRealtimeRefresh(message=null){
  globalThis.__aoraLastRealtimeEvent={receivedAt:Date.now(),message};
  document.dispatchEvent(new CustomEvent("aora:workspace-change",{detail:message||{}}));
  clearTimeout(aoraRealtimeRefreshTimer);
  aoraRealtimeRefreshTimer=setTimeout(async()=>{
    const tasks=[];
    if(typeof refreshWorkspace==="function")tasks.push(refreshWorkspace().catch(()=>{}));
    if(S.adminView==="compliance"&&typeof ensureComplianceData==="function")tasks.push(ensureComplianceData(true).catch(()=>{}));
    await Promise.all(tasks);
  },250);
}
function startWorkspaceFallback(){
  clearInterval(aoraFallbackTimer);
  aoraFallbackTimer=setInterval(()=>{
    if(typeof refreshWorkspace==="function")refreshWorkspace().catch(()=>{});
  },Number(CFG.realtimeFallbackMs||60000));
}
async function disconnectWorkspaceRealtime(){
  clearTimeout(aoraRealtimeReconnectTimer);
  clearTimeout(aoraRealtimeRefreshTimer);
  clearInterval(aoraFallbackTimer);
  aoraRealtimeReconnectTimer=null;
  aoraRealtimeRefreshTimer=null;
  aoraFallbackTimer=null;
  const channel=aoraRealtimeChannel;
  const client=aoraRealtimeClient;
  aoraRealtimeChannel=null;
  aoraRealtimeClient=null;
  aoraRealtimeTopic=null;
  try{if(channel&&client)await client.removeChannel(channel)}catch{}
  setWorkspaceSyncStatus("idle");
}
async function connectWorkspaceRealtime(){
  const token=String(S.session?.token||"");
  if(token.length!==64)return disconnectWorkspaceRealtime();
  startWorkspaceFallback();
  if(!navigator.onLine){setWorkspaceSyncStatus("offline");return}
  if(!globalThis.supabase?.createClient){setWorkspaceSyncStatus("fallback");return}
  const topic=`aora:${await aoraSha256Hex(token)}`;
  if(topic===aoraRealtimeTopic&&aoraRealtimeChannel)return;
  await disconnectWorkspaceRealtime();
  startWorkspaceFallback();
  aoraRealtimeTopic=topic;
  aoraRealtimeClient=globalThis.supabase.createClient(CFG.url,CFG.publishableKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    realtime:{params:{eventsPerSecond:10}}
  });
  setWorkspaceSyncStatus("connecting");
  aoraRealtimeChannel=aoraRealtimeClient
    .channel(topic,{config:{broadcast:{ack:false,self:false},private:false}})
    .on("broadcast",{event:"workspace-change"},scheduleRealtimeRefresh)
    .subscribe(status=>{
      if(status==="SUBSCRIBED")setWorkspaceSyncStatus("realtime");
      else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){
        setWorkspaceSyncStatus("fallback");
        clearTimeout(aoraRealtimeReconnectTimer);
        aoraRealtimeReconnectTimer=setTimeout(()=>connectWorkspaceRealtime().catch(()=>{}),5000);
      }
    });
}
window.addEventListener("online",()=>{connectWorkspaceRealtime().then(scheduleRealtimeRefresh).catch(()=>{})});
window.addEventListener("offline",()=>setWorkspaceSyncStatus("offline"));
