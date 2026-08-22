"use strict";

/* Transfer Before Buy stays inside Bestellen so the two-area navigation does not
 * remove an existing Autopilot safety feature. This layer only composes existing
 * transfer APIs; stock is still deducted only by the hardened dispatch RPC. */

async function loadInventoryWorkspaceTransfers(force=false){
  if(S.adminView!=="inventory"||S.inventorySection!=="orders"||!S.locationId)return;
  const data=S.inventoryWorkspaceCache[inventoryWorkspaceKey("orders")];
  if(!data||data.error||(!force&&data.transferWorkspaceLoaded)||data.transferWorkspaceLoading)return;
  data.transferWorkspaceLoading=true;
  try{
    const[suggestions,transfers]=await Promise.all([
      invRequest("listTransferSuggestions",{locationId:S.locationId}).catch(error=>({suggestions:[],error:error.message})),
      invRequest("listTransfers",{locationId:S.locationId}).catch(error=>({transfers:[],error:error.message}))
    ]);
    data.transferSuggestions=suggestions;
    data.transfers=transfers;
    data.transferWorkspaceLoaded=true;
    S.inventoryPageCache[`${invKey()}:overview`]={stock:data.stock,replenishment:data.replenishment,transferSuggestions:suggestions};
  }finally{
    data.transferWorkspaceLoading=false;
  }
  if(S.adminView==="inventory"&&S.inventorySection==="orders")renderAdmin();
}

function inventoryWorkspaceTransferStatus(status){
  return({draft:"Vorbereitet",dispatched:"Unterwegs",received:"Angekommen",cancelled:"Storniert"})[status]||status;
}

function inventoryWorkspaceTransferSuggestion(s){
  const item=s.item||{},uom=invUom(item),qty=Number(s.recommendedQuantity||0);
  return`<article class="inventory-workspace-transfer-card suggested"><div class="inventory-workspace-product-icon material-symbols-rounded" aria-hidden="true">move_down</div><div><strong>${esc(item.name||"Artikel")}</strong><small>${esc(s.recommendedSourceLocationName||"anderer Standort")} kann ${invNumber(qty)}${uom?` ${esc(uom)}`:""} sicher abgeben.</small><span>${s.canFullyCover?"Deckt den aktuellen Bedarf":"Reduziert den Einkaufsbedarf"}</span></div><button class="btn" type="button" data-inv="autopilot-transfer" data-item="${esc(s.itemId)}" data-source="${esc(s.recommendedSourceLocationId)}">Transfer vorbereiten</button></article>`;
}

function inventoryWorkspaceTransferRow(t){
  const source=loc(t.source_location_id)?.name||t.source_location_id,destination=loc(t.destination_location_id)?.name||t.destination_location_id;
  let action="";
  if(t.status==="draft")action=`<div class="inventory-actions"><button class="btn" type="button" data-inventory-transfer-action="dispatch" data-transfer-id="${t.id}" data-version="${t.version}">Versenden</button><button class="btn outline" type="button" data-inventory-transfer-action="cancel" data-transfer-id="${t.id}" data-version="${t.version}">Stornieren</button></div>`;
  else if(t.status==="dispatched"&&String(t.destination_location_id)===String(S.locationId))action=`<button class="btn" type="button" data-inventory-transfer-action="receive" data-transfer-id="${t.id}" data-version="${t.version}">Ankunft bestätigen</button>`;
  return`<article class="inventory-workspace-transfer-card"><div class="inventory-workspace-product-icon material-symbols-rounded" aria-hidden="true">local_shipping</div><div><strong>${esc(source)} → ${esc(destination)}</strong><small>${esc(inventoryWorkspaceTransferStatus(t.status))}${t.note?` · ${esc(t.note)}`:""}</small></div><span class="inventory-status">${esc(inventoryWorkspaceTransferStatus(t.status))}</span>${action}</article>`;
}

function inventoryWorkspaceTransferSection(data){
  const suggestions=data.transferSuggestions?.suggestions||[],transfers=(data.transfers?.transfers||[]).filter(t=>["draft","dispatched"].includes(t.status));
  if(!data.transferWorkspaceLoaded)return`<section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Transfer vor Einkauf</span><h2>Andere Standorte werden geprüft …</h2><p>Aora kauft erst, wenn kein sicherer Überschuss in einem anderen Laden verfügbar ist.</p></div></div></section>`;
  if(!suggestions.length&&!transfers.length)return"";
  return`<section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Transfer vor Einkauf</span><h2>${suggestions.length?"Erst intern verschieben":"Laufende Transfers"}</h2><p>Aora schützt PAR- und Meldebestand des abgebenden Standorts. Bestand wird erst beim tatsächlichen Versand reduziert.</p></div></div>${suggestions.length?`<div class="inventory-workspace-transfer-list">${suggestions.map(inventoryWorkspaceTransferSuggestion).join("")}</div>`:""}${transfers.length?`<div class="inventory-workspace-transfer-list active">${transfers.map(inventoryWorkspaceTransferRow).join("")}</div>`:""}</section>`;
}

const _inventoryOrdersWorkspaceWithTransfers=inventoryOrdersWorkspacePage;
inventoryOrdersWorkspacePage=function(){
  const html=_inventoryOrdersWorkspaceWithTransfers();
  const data=S.inventoryWorkspaceCache[inventoryWorkspaceKey("orders")];
  if(data&&!data.error)queueMicrotask(()=>loadInventoryWorkspaceTransfers(false));
  if(!data||data.error)return html;
  const section=inventoryWorkspaceTransferSection(data);
  if(!section)return html;
  const marker='<section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Bestellung → Wareneingang</span>';
  return html.replace(marker,section+marker);
};

app.addEventListener("click",async event=>{
  const button=event.target.closest?.("[data-inventory-transfer-action]");
  if(!button)return;
  event.preventDefault();
  const action=button.dataset.inventoryTransferAction,transferId=button.dataset.transferId,expectedVersion=Number(button.dataset.version);
  if(!["dispatch","receive","cancel"].includes(action)||!transferId||!Number.isFinite(expectedVersion))return;
  button.disabled=true;
  try{
    const body={transferId,expectedVersion};
    if(action!=="cancel")body.idempotencyKey=crypto.randomUUID();
    await invRequest(action==="dispatch"?"dispatchTransfer":action==="receive"?"receiveTransfer":"cancelTransfer",body);
    inventoryWorkspaceInvalidate();S.inventoryPageCache={};
    toast(action==="dispatch"?"Transfer ist unterwegs.":action==="receive"?"Transfer wurde angenommen.":"Transfer wurde storniert.");
    renderAdmin();
  }catch(error){toast(error.message,"error");button.disabled=false}
},true);
