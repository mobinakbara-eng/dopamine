"use strict";

let inventoryScannerStream=null,inventoryScannerTimer=null,inventoryScannerBusy=false,inventoryPendingScan=null,inventoryQueueFlushBusy=false;
const INVENTORY_SCAN_QUEUE_TTL=24*60*60*1000,INVENTORY_SCAN_QUEUE_MAX=100;

function inventoryScanQueueKey(locationId){
  const org=S.session?.organizationId||CFG.slug,subject=S.session?.subjectId||"employee";
  return`aora:inventory:scan-queue:${org}:${subject}:${locationId||"none"}`;
}
function readInventoryScanQueue(locationId){
  const key=inventoryScanQueueKey(locationId);
  try{
    const now=Date.now(),raw=JSON.parse(localStorage.getItem(key)||"[]"),queue=(Array.isArray(raw)?raw:[]).filter(x=>x?.idempotencyKey&&x?.createdAt&&now-Number(x.createdAt)<=INVENTORY_SCAN_QUEUE_TTL).slice(-INVENTORY_SCAN_QUEUE_MAX);
    if(queue.length) localStorage.setItem(key,JSON.stringify(queue)); else localStorage.removeItem(key);
    return queue;
  }catch{localStorage.removeItem(key);return[]}
}
function writeInventoryScanQueue(locationId,queue){
  const key=inventoryScanQueueKey(locationId),safe=queue.filter(Boolean).slice(-INVENTORY_SCAN_QUEUE_MAX);
  try{if(safe.length)localStorage.setItem(key,JSON.stringify(safe));else localStorage.removeItem(key)}catch{}
  updateInventoryOfflineBadge(locationId);
}
function queueInventoryScan(locationId,operation){
  const queue=readInventoryScanQueue(locationId);
  if(queue.some(x=>x.idempotencyKey===operation.idempotencyKey))return queue.length;
  if(queue.length>=INVENTORY_SCAN_QUEUE_MAX)throw Object.assign(new Error("Offline-Speicher ist voll. Bitte kurz online gehen und synchronisieren."),{status:507});
  queue.push({...operation,createdAt:operation.createdAt||Date.now(),locationId});
  writeInventoryScanQueue(locationId,queue);
  return queue.length;
}
function retryableInventoryError(error){return error?.retryable===true||[408,425,429,500,502,503,504].includes(Number(error?.status))}
function updateInventoryOfflineBadge(locationId){
  const n=document.getElementById("inventory-offline-count");
  if(!n)return;
  const count=readInventoryScanQueue(locationId).length;
  n.textContent=count?`${count} offline gespeichert`:navigator.onLine?"Online":"Offline";
  n.dataset.pending=count?"1":"0";
}
async function flushInventoryScanQueue(locationId,quiet=false){
  if(inventoryQueueFlushBusy||!navigator.onLine||!S.session||S.accessRole!=="employee")return false;
  inventoryQueueFlushBusy=true;
  try{
    let queue=readInventoryScanQueue(locationId),changed=false;
    for(let i=0;i<queue.length;){
      const op=queue[i];
      try{
        const data=op.kind==="qr"
          ?await invRequest("issueQrUnit",{locationId,token:op.token,quantity:op.quantity??null,idempotencyKey:op.idempotencyKey})
          :await invRequest("issueQrShortCode",{locationId,shortCode:op.shortCode,quantity:op.quantity??null,idempotencyKey:op.idempotencyKey});
        queue.splice(i,1);changed=true;writeInventoryScanQueue(locationId,queue);
        if(!quiet)showInventoryScanSuccess(data,true);
      }catch(error){
        if(retryableInventoryError(error))break;
        queue.splice(i,1);changed=true;writeInventoryScanQueue(locationId,queue);
        if(!quiet)toast(`Offline-Buchung konnte nicht übernommen werden: ${error.message}`,"error");
      }
    }
    if(changed&&!queue.length&&!quiet)toast("Offline-Buchungen synchronisiert.");
    return !queue.length;
  }finally{inventoryQueueFlushBusy=false;updateInventoryOfflineBadge(locationId)}
}

async function ensureEmployeeInventoryAvailability(employee){
  if(!S.session||S.accessRole!=="employee")return;
  const locationId=employee?.locationId||S.session?.locationId||S.locationId;
  if(!locationId)return;
  const key=`${S.session.token}:${locationId}`;
  if(S.inventoryAvailabilityCache[key]!==undefined)return;
  S.inventoryAvailabilityCache[key]=null;
  try{S.inventoryAvailabilityCache[key]=await invRequest("availability",{locationId})}catch{S.inventoryAvailabilityCache[key]={enabled:false}}
  if(S.employeeView==="more")renderEmployee();
}

const _employeeView=employeeView;
employeeView=function(employee,view){
  if(view==="inventory-scan"){
    queueMicrotask(()=>startInventoryScanner(employee));
    return inventoryScanView(employee);
  }
  if(view!=="inventory-scan")stopInventoryScanner();
  let html=_employeeView(employee,view);
  if(view==="more"){
    const locationId=employee?.locationId||S.session?.locationId||S.locationId,a=S.inventoryAvailabilityCache[`${S.session?.token}:${locationId}`];
    if(a?.enabled&&a?.permissions?.consume)html=html.replace('<button class="btn outline" style="width:100%;margin-top:14px" data-a="logout">',`<button class="inventory-more-card" type="button" data-inv="employee-scan"><span><strong>QR scannen</strong><small>Verbrauch direkt aus dem Bestand buchen</small></span>${I.arrow}</button><button class="btn outline" style="width:100%;margin-top:14px" data-a="logout">`);
  }
  return html;
};
const _renderEmployee=renderEmployee;
renderEmployee=function(){const employee=emp(S.session?.subjectId)||S.state?.employees?.[0];_renderEmployee();queueMicrotask(()=>ensureEmployeeInventoryAvailability(employee))};

function inventoryScanView(employee){
  const locationId=employee?.locationId||S.session?.locationId||S.locationId;
  return`<section class="inventory-scan-page">
    <div class="inventory-scan-title"><div class="caps muted">Bestand · ${esc(loc(locationId)?.name||"")}</div><h1>QR scannen</h1><p>QR-Code auf einer Verpackung scannen. Bei schlechtem Netz speichert Aora die Buchung mit derselben sicheren Vorgangs-ID und synchronisiert später.</p></div>
    <div class="inventory-offline-bar"><span id="inventory-offline-count">${navigator.onLine?"Online":"Offline"}</span><button type="button" class="btn outline" data-inv="sync-scan-queue">Synchronisieren</button></div>
    <div class="inventory-scanner"><video id="inventory-camera" playsinline muted></video><div class="inventory-scan-frame"></div></div>
    <div id="inventory-scan-result" class="inventory-scan-status">Kamera wird gestartet …</div>
    <div id="inventory-partial-consume"></div>
    <form class="inventory-shortcode" id="inventory-shortcode"><input class="input" name="shortCode" placeholder="Kurzcode eingeben" autocomplete="off"><button class="btn" type="submit">Prüfen</button></form>
  </section>`;
}

function makeInventoryScanOperation(kind,value,quantity=null){
  return{kind,idempotencyKey:crypto.randomUUID(),token:kind==="qr"?value:undefined,shortCode:kind==="short"?value:undefined,quantity,createdAt:Date.now()};
}
function showInventoryQueued(locationId){
  const n=document.getElementById("inventory-scan-result"),count=readInventoryScanQueue(locationId).length;
  if(n){n.className="inventory-scan-status offline";n.innerHTML=`<strong>✓ Offline gespeichert</strong><span>${count} Buchung${count===1?"":"en"} warten auf Synchronisierung.</span>`}
  updateInventoryOfflineBadge(locationId);
  navigator.vibrate?.([45,45,45]);
}
function showInventoryPartialPrompt(meta,kind,value,employee){
  inventoryScannerBusy=true;
  inventoryPendingScan={meta,kind,value};
  const host=document.getElementById("inventory-partial-consume");
  if(!host)return;
  const remaining=Number(meta.remainingQuantity||0),suggested=Math.min(remaining,Number(meta.defaultConsumeQuantity||0)||remaining),uom=meta.item?.base_uom||"Einheit";
  host.innerHTML=`<form class="inventory-partial-card" id="inventory-partial-form">
    <div><span class="caps muted">Teilentnahme</span><strong>${esc(meta.item?.name||"Artikel")}</strong><small>${esc(meta.pack?.label||"Verpackung")} · noch ${invNumber(remaining)} ${esc(uom)} in diesem QR</small></div>
    <label>Menge<input class="input" type="number" name="quantity" min="0.001" max="${remaining}" step="0.001" value="${suggested}" required></label>
    <div class="actions"><button class="btn outline" type="button" data-inv-partial="all">Rest ${invNumber(remaining)} buchen</button><button class="btn" type="submit">Verbrauch buchen</button><button class="btn outline" type="button" data-inv-partial="cancel">Abbrechen</button></div>
  </form>`;
  const form=host.querySelector("form");
  form.addEventListener("click",e=>{
    const b=e.target.closest("[data-inv-partial]");if(!b)return;
    if(b.dataset.invPartial==="all")form.quantity.value=String(remaining);
    else if(b.dataset.invPartial==="cancel"){host.innerHTML="";inventoryPendingScan=null;inventoryScannerBusy=false}
  });
  form.addEventListener("submit",async e=>{
    e.preventDefault();
    const qty=Number(form.quantity.value);
    if(!Number.isFinite(qty)||qty<=0||qty>remaining)return toast("Bitte eine gültige Verbrauchsmenge eingeben.","error");
    const operation=makeInventoryScanOperation(kind,value,qty),submit=form.querySelector('button[type="submit"]');
    submit.disabled=true;
    try{
      const data=kind==="qr"
        ?await invRequest("issueQrUnit",{locationId:employee.locationId,token:value,quantity:qty,idempotencyKey:operation.idempotencyKey})
        :await invRequest("issueQrShortCode",{locationId:employee.locationId,shortCode:value,quantity:qty,idempotencyKey:operation.idempotencyKey});
      host.innerHTML="";inventoryPendingScan=null;showInventoryScanSuccess(data);navigator.vibrate?.(80);
    }catch(error){
      if(retryableInventoryError(error)){
        queueInventoryScan(employee.locationId,operation);host.innerHTML="";inventoryPendingScan=null;showInventoryQueued(employee.locationId);
      }else{toast(error.message,"error");submit.disabled=false;return}
    }
    setTimeout(()=>inventoryScannerBusy=false,1000);
  });
}

async function inspectAndConsumeInventory(kind,value,employee){
  inventoryScannerBusy=true;
  const locationId=employee.locationId,operation=makeInventoryScanOperation(kind,value,null);
  if(!navigator.onLine){
    queueInventoryScan(locationId,operation);showInventoryQueued(locationId);setTimeout(()=>inventoryScannerBusy=false,900);return;
  }
  try{
    const meta=kind==="qr"
      ?await invRequest("inspectQrUnit",{locationId,token:value})
      :await invRequest("inspectQrShortCode",{locationId,shortCode:value});
    if(meta.consumptionMode==="partial_pack")return showInventoryPartialPrompt(meta,kind,value,employee);
    const data=kind==="qr"
      ?await invRequest("issueQrUnit",{locationId,token:value,idempotencyKey:operation.idempotencyKey})
      :await invRequest("issueQrShortCode",{locationId,shortCode:value,idempotencyKey:operation.idempotencyKey});
    showInventoryScanSuccess(data);navigator.vibrate?.(80);
  }catch(error){
    if(retryableInventoryError(error)){
      try{queueInventoryScan(locationId,operation);showInventoryQueued(locationId)}catch(queueError){toast(queueError.message,"error")}
    }else{
      const n=document.getElementById("inventory-scan-result");if(n){n.className="inventory-scan-status error";n.innerHTML=`<strong>${esc(error.message)}</strong>`}
    }
  }finally{if(!inventoryPendingScan)setTimeout(()=>inventoryScannerBusy=false,1100)}
}

async function startInventoryScanner(employee){
  if(S.employeeView!=="inventory-scan")return;
  stopInventoryScanner();
  const locationId=employee?.locationId||S.session?.locationId||S.locationId;
  employee={...employee,locationId};
  updateInventoryOfflineBadge(locationId);
  flushInventoryScanQueue(locationId,true).catch(()=>{});
  const video=document.getElementById("inventory-camera"),result=document.getElementById("inventory-scan-result");
  if(!video)return;
  try{
    inventoryScannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
    video.srcObject=inventoryScannerStream;await video.play();result.textContent="QR-Code in den Rahmen halten.";
    const canvas=document.createElement("canvas"),ctx2=canvas.getContext("2d",{willReadFrequently:true});let detector=null;
    if("BarcodeDetector" in window){try{detector=new BarcodeDetector({formats:["qr_code"]})}catch{}}
    const tick=async()=>{
      if(S.employeeView!=="inventory-scan"||!inventoryScannerStream)return;
      if(!inventoryScannerBusy&&video.readyState>=2){
        try{
          let code="";
          if(detector){const found=await detector.detect(video);code=found?.[0]?.rawValue||""}
          else if(window.jsQR){canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx2.drawImage(video,0,0);const image=ctx2.getImageData(0,0,canvas.width,canvas.height);code=window.jsQR(image.data,image.width,image.height,{inversionAttempts:"dontInvert"})?.data||""}
          if(/^A1\.k1\./.test(code))await inspectAndConsumeInventory("qr",code,employee);
        }catch{}
      }
      inventoryScannerTimer=setTimeout(tick,250);
    };
    tick();
  }catch{result.innerHTML='<strong>Kamera nicht verfügbar.</strong><br>Bitte Kamerazugriff erlauben oder den Kurzcode eingeben.'}
  document.getElementById("inventory-shortcode")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const f=e.currentTarget,value=String(new FormData(f).get("shortCode")||"").trim();
    if(!value||inventoryScannerBusy)return;
    await inspectAndConsumeInventory("short",value,employee);f.reset();
  });
}

function showInventoryScanSuccess(data,fromQueue=false){
  const n=document.getElementById("inventory-scan-result");if(!n)return;
  const item=data.item?.name||"Artikel",pack=data.pack?.label||"",uom=data.item?.base_uom||"",consumed=Math.abs(Number(data.consumedQuantity??data.quantityDelta??0)),remaining=data.remainingQuantity==null?null:Number(data.remainingQuantity),onHand=Number(data.onHand??0);
  n.className="inventory-scan-success";
  n.innerHTML=`<strong>✓ ${esc(item)}</strong><span>${invNumber(consumed)}${uom?` ${esc(uom)}`:""}${pack?` aus ${esc(pack)}`:""} verbraucht · Bestand ${invNumber(onHand)}${uom?` ${esc(uom)}`:""}${remaining!=null&&remaining>0?` · QR-Rest ${invNumber(remaining)}${uom?` ${esc(uom)}`:""}`:""}${fromQueue?" · offline synchronisiert":""}</span>`;
  setTimeout(()=>{if(n.isConnected&&!inventoryPendingScan){n.className="inventory-scan-status";n.textContent="Weiter scannen …"}},1600);
}

function stopInventoryScanner(){
  if(inventoryScannerTimer)clearTimeout(inventoryScannerTimer);inventoryScannerTimer=null;
  inventoryScannerStream?.getTracks?.().forEach(t=>t.stop());inventoryScannerStream=null;
  inventoryScannerBusy=false;inventoryPendingScan=null;
}

window.addEventListener("online",()=>{
  if(S.accessRole!=="employee"||S.employeeView!=="inventory-scan")return;
  const employee=emp(S.session?.subjectId)||S.state?.employees?.[0],locationId=employee?.locationId||S.session?.locationId||S.locationId;
  flushInventoryScanQueue(locationId).catch(()=>{});
});
window.addEventListener("offline",()=>{
  if(S.accessRole!=="employee"||S.employeeView!=="inventory-scan")return;
  const employee=emp(S.session?.subjectId)||S.state?.employees?.[0];updateInventoryOfflineBadge(employee?.locationId||S.session?.locationId||S.locationId);
});

app.addEventListener("click",e=>{
  const b=e.target.closest("[data-inv]");if(!b)return;
  if(b.dataset.inv==="employee-scan"){S.employeeView="inventory-scan";renderEmployee()}
  else if(b.dataset.inv==="sync-scan-queue"){
    const employee=emp(S.session?.subjectId)||S.state?.employees?.[0],locationId=employee?.locationId||S.session?.locationId||S.locationId;
    if(!navigator.onLine)return toast("Noch offline. Die Buchungen bleiben sicher gespeichert.","error");
    flushInventoryScanQueue(locationId).catch(error=>toast(error.message,"error"));
  }
});
