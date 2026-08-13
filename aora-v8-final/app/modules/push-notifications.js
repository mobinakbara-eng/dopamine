"use strict";

const AORA_VAPID_PUBLIC_KEY="BDreKm_dcHYhQoQ-USmHpC951CE3DTxYZJW6didUAdDjYaPo1y60mgdjf-XVKiz1WEmIoLYeRP1eSO76Zfz1MWM";
let aoraPushBoundToken=null;
let aoraPushNeedsSubscription=false;
let aoraPushBusy=false;

function aoraPushSupported(){return "serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window}
function aoraPushIos(){return /iPad|iPhone|iPod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)}
function aoraPushStandalone(){return window.matchMedia?.("(display-mode: standalone)")?.matches===true||navigator.standalone===true}
function aoraVapidKey(value){
  const base64=(value+"=".repeat((4-value.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/");
  return Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
}
async function aoraPushApi(action,body={},token=S.session?.token){
  if(!token)throw new Error("Aktive Mitarbeitersitzung erforderlich.");
  const response=await fetch(`${CFG.url}/functions/v1/aora-v8-domain-api`,{
    method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},
    body:JSON.stringify({action,token,...body})
  });
  const text=await response.text();
  let payload={};
  try{payload=text?JSON.parse(text):{}}catch{payload={error:{message:text}}}
  if(!response.ok||payload?.error)throw Object.assign(new Error(payload?.error?.message||payload?.message||`HTTP ${response.status}`),{status:response.status});
  return payload?.data??payload;
}
async function aoraCurrentPushSubscription(){
  if(!aoraPushSupported())return null;
  const registration=await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}
function aoraPushCard(){
  if(!aoraPushSupported())return"";
  if(aoraPushIos()&&!aoraPushStandalone())return '<section class="aora-push-card"><div><strong>Push-Mitteilungen auf dem iPhone</strong><span>Aora zuerst zum Home-Bildschirm hinzufügen und anschließend von dort öffnen.</span></div></section>';
  if(Notification.permission==="denied")return '<section class="aora-push-card"><div><strong>Mitteilungen sind blockiert</strong><span>Bitte Benachrichtigungen für Aora in den Geräteeinstellungen erlauben.</span></div></section>';
  if(Notification.permission==="granted"&&!aoraPushNeedsSubscription)return"";
  return '<section class="aora-push-card"><div><strong>Keine wichtigen Updates verpassen</strong><span>Schichten, Aufgaben und relevante Änderungen direkt als Push-Mitteilung erhalten.</span></div><button type="button" class="btn" data-a="enable-push">Aktivieren</button></section>';
}
async function enableAoraPush(button){
  if(aoraPushBusy)return;
  aoraPushBusy=true;if(button)button.disabled=true;
  try{
    if(!aoraPushSupported())throw new Error("Push-Benachrichtigungen werden auf diesem Gerät nicht unterstützt.");
    if(aoraPushIos()&&!aoraPushStandalone())throw new Error("Bitte Aora zuerst zum Home-Bildschirm hinzufügen und von dort öffnen.");
    const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    if(permission!=="granted")throw new Error("Benachrichtigungen wurden nicht freigegeben.");
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:aoraVapidKey(AORA_VAPID_PUBLIC_KEY)});
    await aoraPushApi("pushSubscribe",{subscription:subscription.toJSON(),userAgent:navigator.userAgent});
    aoraPushBoundToken=S.session?.token||null;aoraPushNeedsSubscription=false;
    renderEmployee();toast("Push-Benachrichtigungen sind aktiviert.","success");
  }catch(error){toast(error.message||"Push-Benachrichtigungen konnten nicht aktiviert werden.","error");if(S.accessRole==="employee"&&S.session)renderEmployee()}
  finally{aoraPushBusy=false;if(button?.isConnected)button.disabled=false}
}
async function reconcileAoraPush(){
  if(!aoraPushSupported()||S.accessRole!=="employee"||!S.session?.token||Notification.permission!=="granted")return;
  const subscription=await aoraCurrentPushSubscription();
  if(!subscription){if(!aoraPushNeedsSubscription){aoraPushNeedsSubscription=true;renderEmployee()}return}
  if(aoraPushBoundToken===S.session.token)return;
  await aoraPushApi("pushSubscribe",{subscription:subscription.toJSON(),userAgent:navigator.userAgent});
  aoraPushBoundToken=S.session.token;aoraPushNeedsSubscription=false;
}
async function aoraPushBeforeLogout(session=S.session){
  if(!aoraPushSupported()||session?.role!=="employee"||!session?.token)return;
  const subscription=await aoraCurrentPushSubscription();if(!subscription)return;
  try{await aoraPushApi("pushUnsubscribe",{endpoint:subscription.endpoint},session.token)}catch(error){console.warn("Aora push unsubscribe failed",error)}
  try{await subscription.unsubscribe()}catch{}
  aoraPushBoundToken=null;aoraPushNeedsSubscription=false;
}
async function aoraPushDropLocal(){
  const subscription=await aoraCurrentPushSubscription().catch(()=>null);try{await subscription?.unsubscribe()}catch{}
  aoraPushBoundToken=null;aoraPushNeedsSubscription=false;
}
window.aoraPushBeforeLogout=aoraPushBeforeLogout;
window.aoraPushDropLocal=aoraPushDropLocal;
app.addEventListener("click",event=>{
  const button=event.target.closest('[data-a="enable-push"]');
  if(button)enableAoraPush(button);
});
window.addEventListener("load",()=>reconcileAoraPush().catch(error=>console.warn("Aora push reconciliation failed",error)));
window.addEventListener("pageshow",()=>reconcileAoraPush().catch(()=>{}));
if(aoraPushSupported())navigator.serviceWorker.addEventListener("message",event=>{
  if(event.data?.type!=="AORA_NOTIFICATION_OPEN")return;
  const notificationId=String(event.data.notificationId||"");
  if(notificationId&&S.accessRole==="employee"&&S.session?.token)aoraPushApi("markNotificationRead",{notificationId}).catch(()=>{});
  const target=String(event.data.url||"");if(target.startsWith("/"))location.assign(target);
});
