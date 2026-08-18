"use strict";

const INVENTORY_FUNCTION=(typeof CFG!=="undefined"&&CFG.environment==="preview"&&location.hostname.endsWith("-mobins-projects-4f428afa.vercel.app"))?"aora-v8-inventory-preview":"aora-v8-inventory-next";
S.inventoryTab=S.inventoryTab||"overview";
S.inventoryAvailabilityCache=S.inventoryAvailabilityCache||{};
S.inventoryPageCache=S.inventoryPageCache||{};
S.inventoryOrderFocus=S.inventoryOrderFocus||null;

async function invRequest(action,body={}){return request(INVENTORY_FUNCTION,{action,...body,token:S.session?.token})}
function invKey(){return`${S.session?.token||"none"}:${S.locationId||"none"}`}
function invAvailability(){return S.inventoryAvailabilityCache[invKey()]||null}
function invNumber(value,maximumFractionDigits=3){const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat("de-DE",{maximumFractionDigits}).format(n):"–"}
function invUom(x){return String(x?.base_uom||x?.item?.base_uom||"").trim()}
function invDateTime(value){if(!value)return"";const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}

function setInventoryNav(list,show){
  const i=list.findIndex(x=>x[0]==="inventory");
  if(i>=0)list.splice(i,1);
  if(show){const s=list.findIndex(x=>x[0]==="settings");list.splice(s>=0?s:list.length,0,["inventory","Bestand",I.grid])}
}
function syncInventoryNav(){const a=invAvailability();if(isOwner())setInventoryNav(ownerNav,Boolean(a?.enabled));else setInventoryNav(managerNav,Boolean(a?.enabled))}
async function ensureAdminInventoryAvailability(){
  if(!S.session||!["owner","manager"].includes(S.accessRole)||!S.locationId)return;
  const k=invKey();
  if(S.inventoryAvailabilityCache[k]!==undefined)return;
  S.inventoryAvailabilityCache[k]=null;
  try{S.inventoryAvailabilityCache[k]=await invRequest("availability",{locationId:S.locationId})}
  catch{S.inventoryAvailabilityCache[k]={enabled:false}}
  if(S.adminView!=="inventory")renderAdmin();
}

const _renderAdmin=renderAdmin;
renderAdmin=function(){syncInventoryNav();_renderAdmin();queueMicrotask(ensureAdminInventoryAvailability)};
const _adminTitle=adminTitle;
adminTitle=function(){return S.adminView==="inventory"?"Bestand":_adminTitle()};
const _adminView=adminView;
adminView=function(){return S.adminView==="inventory"?inventoryPage():_adminView()};

function inventoryTabs(){
  return`<div class="inventory-tabs">${[["overview","Heute"],["stock","Bestand"],["orders","Bestellen"],["receiving","Wareneingang"]].map(([id,l])=>`<button class="${S.inventoryTab===id?"active":""}" data-inv="tab" data-tab="${id}">${l}</button>`).join("")}</div>`;
}

function inventoryPage(){
  const a=invAvailability();
  if(!a)return`<div class="inventory-shell"><div class="inventory-card"><div class="inventory-empty">Zugriff wird geprüft …</div></div></div>`;
  if(!a.enabled)return`<div class="inventory-shell"><div class="inventory-card"><div class="inventory-empty">Bestand ist für diesen Standort nicht freigeschaltet.</div></div></div>`;
  const c=S.inventoryPageCache[`${invKey()}:${S.inventoryTab}`];
  queueMicrotask(()=>loadInventoryTab(false));
  return`<div class="inventory-shell">
    <div class="inventory-head">
      <div><div class="caps muted">Aora Bestand · ${esc(loc(S.locationId)?.name||"")}</div><h1>${S.inventoryTab==="overview"?"Heute":"Bestand"}</h1><p>${S.inventoryTab==="overview"?"Aora zeigt nur, was heute Aufmerksamkeit braucht.":"Einfach zählen, bestellen, annehmen und scannen."}</p></div>
      <div class="inventory-actions"><button class="btn outline" data-inv="refresh">Aktualisieren</button>${S.inventoryTab==="orders"?'<button class="btn" data-inv="new-order">Neue Bestellung</button>':S.inventoryTab!=="receiving"?'<button class="btn" data-inv="start-count">Bestand zählen</button>':""}</div>
    </div>
    ${inventoryTabs()}
    ${c?renderInventoryTab(c):'<div class="inventory-card"><div class="inventory-empty">Bestand wird geladen …</div></div>'}
  </div>`;
}

async function loadInventoryTab(force=false){
  if(S.adminView!=="inventory"||!S.locationId)return;
  const k=`${invKey()}:${S.inventoryTab}`;
  if(S.inventoryPageCache[k]&&!force)return;
  try{
    let d;
    if(S.inventoryTab==="overview"){
      const a=invAvailability(),canReplenish=Boolean(a?.features?.replenishmentSuggestions&&a?.permissions?.procurement);
      const requests=[invRequest("overview",{locationId:S.locationId}),invRequest("listStock",{locationId:S.locationId})];
      if(canReplenish)requests.push(invRequest("listReplenishment",{locationId:S.locationId}));
      const[o,s,replenishment]=await Promise.all(requests);
      d={overview:o,stock:s,replenishment:replenishment||{suggestions:[]}};
    }else if(S.inventoryTab==="stock"){
      const[s,m]=await Promise.all([invRequest("listStock",{locationId:S.locationId}),invRequest("listMovements",{locationId:S.locationId,limit:40})]);
      d={stock:s,movements:m};
    }else if(S.inventoryTab==="orders"){
      const[o,s]=await Promise.all([invRequest("listPurchaseOrders",{locationId:S.locationId}),invRequest("listSuppliers",{locationId:S.locationId})]);
      d={orders:o,suppliers:s};
    }else d={orders:await invRequest("listPurchaseOrders",{locationId:S.locationId})};
    S.inventoryPageCache[k]=d;
    if(S.adminView==="inventory")renderAdmin();
  }catch(e){S.inventoryPageCache[k]={error:e.message};renderAdmin()}
}

function renderInventoryTab(d){
  if(d.error)return`<div class="inventory-card"><div class="inventory-empty">${esc(d.error)}</div></div>`;
  return S.inventoryTab==="overview"?inventoryOverview(d):S.inventoryTab==="stock"?inventoryStock(d):S.inventoryTab==="orders"?inventoryOrders(d):inventoryReceiving(d);
}

function invStockRow(x){
  const low=Number(x.onHand)<=Number(x.reorderPoint||0),uom=invUom(x),search=esc(`${x.name||""} ${x.sku||""} ${x.category||""}`.toLocaleLowerCase("de-DE"));
  return`<div class="inventory-row" data-stock-row data-stock-search="${search}">
    <div><strong>${esc(x.name||"Artikel")}</strong><small>${esc([x.sku,x.category].filter(Boolean).join(" · "))}</small></div>
    <div><small>Bestand</small><b>${invNumber(x.onHand)}${uom?` ${esc(uom)}`:""}</b></div>
    <div><small>PAR</small><b>${x.parLevel==null?"–":`${invNumber(x.parLevel)}${uom?` ${esc(uom)}`:""}`}</b></div>
    <div><small>Meldebestand</small><b>${invNumber(x.reorderPoint||0)}</b></div>
    <span class="inventory-status ${low?"low":"ok"}">${low?"Niedrig":"OK"}</span>
  </div>`;
}

function inventoryAutopilotAction(x,suggestion){
  const uom=invUom(x),qty=Number(suggestion?.suggestedQuantity||0),hasSuggestion=Number.isFinite(qty)&&qty>0;
  const onHand=invNumber(x.onHand),inTransit=invNumber(x.inTransit||0),par=x.parLevel==null?"–":invNumber(x.parLevel);
  return`<article class="inventory-action-card ${Number(x.onHand)<=0?"critical":""}">
    <div class="inventory-action-main">
      <div class="inventory-action-icon">${Number(x.onHand)<=0?"!":"↓"}</div>
      <div><div class="inventory-action-label">${Number(x.onHand)<=0?"Kritisch":"Nachbestellen"}</div><h3>${esc(x.name||"Artikel")}</h3><p>Bestand ${onHand}${uom?` ${esc(uom)}`:""} · unterwegs ${inTransit}${uom?` ${esc(uom)}`:""} · PAR ${par}${uom&&par!=="–"?` ${esc(uom)}`:""}</p></div>
    </div>
    <div class="inventory-action-decision">
      ${hasSuggestion?`<span>Aora Vorschlag</span><strong>${invNumber(qty)}${uom?` ${esc(uom)}`:""}</strong>`:'<span>Bestand prüfen</span><strong>Aktion nötig</strong>'}
      <button class="btn" type="button" data-inv="autopilot-order" data-item="${x.itemId}" data-suggested="${hasSuggestion?qty:""}">Bestellung vorbereiten</button>
    </div>
  </article>`;
}

function inventoryOverview(d){
  const o=d.overview||{},items=d.stock?.items||[],suggestions=d.replenishment?.suggestions||[],sm=new Map(suggestions.map(s=>[String(s.item_id),s]));
  const low=items.filter(x=>Number(x.onHand)<=Number(x.reorderPoint||0)).sort((a,b)=>Number(a.onHand)-Number(b.onHand));
  return`<div class="inventory-kpis">
    <div class="inventory-kpi"><strong>${o.lowStockCount||0}</strong><span>brauchen Aufmerksamkeit</span></div>
    <div class="inventory-kpi"><strong>${o.openOrderCount||0}</strong><span>Bestellungen offen</span></div>
    <div class="inventory-kpi"><strong>${o.inTransitCount||0}</strong><span>Transfers unterwegs</span></div>
    <div class="inventory-kpi"><strong>${o.pendingPrintCount||0}</strong><span>Etiketten offen</span></div>
  </div>
  <section class="inventory-today">
    <div class="inventory-section-head"><div><span class="caps muted">Aora Autopilot</span><h2>${low.length?`${low.length} Aktion${low.length===1?"":"en"} brauchen dich`:"Alles im grünen Bereich"}</h2></div><small>Vorschläge berücksichtigen offenen Zulauf, Transit und reservierten Bestand, sofern Replenishment aktiv ist.</small></div>
    ${low.length?`<div class="inventory-action-list">${low.slice(0,12).map(x=>inventoryAutopilotAction(x,sm.get(String(x.itemId)))).join("")}</div>`:'<div class="inventory-card inventory-all-good"><strong>✓ Heute ist nichts kritisch.</strong><p>Keine Position liegt unter ihrem Meldebestand.</p></div>'}
  </section>`;
}

function inventoryMovements(d){
  const movements=d.movements?.movements||[];
  return`<article class="inventory-card"><div class="inventory-card-head"><h2>Letzte Bewegungen</h2><small class="muted">Ledger</small></div><div class="inventory-movement-list">${movements.slice(0,20).map(m=>{
    const delta=Number(m.quantityDelta||0),uom=invUom(m);
    return`<div class="inventory-movement-row"><div><strong>${esc(m.item?.name||"Artikel")}</strong><small>${esc(m.reason_code||m.movement_type||"")} · ${esc(invDateTime(m.occurred_at))}</small></div><b class="${delta<0?"negative":"positive"}">${delta>0?"+":""}${invNumber(delta)}${uom?` ${esc(uom)}`:""}</b></div>`;
  }).join("")||'<div class="inventory-empty">Noch keine Bewegungen.</div>'}</div></article>`;
}

function inventoryStock(d){
  return`<div class="inventory-stock-stack"><article class="inventory-card">
    <div class="inventory-card-head inventory-stock-head"><h2>Aktueller Bestand</h2><div class="inventory-actions"><label class="inventory-search"><span>⌕</span><input type="search" placeholder="Artikel, SKU oder Kategorie" data-inv-stock-search autocomplete="off"></label><button class="btn outline" data-inv="employee-access">Scan-Zugriff</button><button class="btn outline" data-inv="start-count">Bestand zählen</button></div></div>
    <div data-stock-list>${(d.stock?.items||[]).map(invStockRow).join("")||'<div class="inventory-empty">Noch keine Artikel.</div>'}</div>
    <div class="inventory-empty" data-stock-empty hidden>Keine passenden Artikel gefunden.</div>
  </article>${inventoryMovements(d)}</div>`;
}

function invStatus(s){return({draft:"Entwurf",ready:"Bereit",sending:"Wird gesendet",submitted:"Bestellt",placed:"Bestellt",send_failed:"Versandfehler",delivered:"Geliefert",partially_received:"Teilweise erhalten",received:"Erhalten",cancelled:"Storniert"})[s]||s}

function inventoryOrders(d){
  const focus=S.inventoryOrderFocus;
  return`${focus?`<div class="inventory-focus-banner"><div><strong>Aora hat eine Nachbestellung vorbereitet.</strong><small>Wähle den passenden Lieferanten; die empfohlene Menge wird automatisch vorgeschlagen.</small></div><button class="btn" data-inv="new-order">Lieferant wählen</button></div>`:""}<article class="inventory-card"><div class="inventory-card-head"><h2>Bestellungen</h2><div class="inventory-actions"><button class="btn outline" data-inv="suppliers">Lieferanten</button><button class="btn" data-inv="new-order">Neue Bestellung</button></div></div>${(d.orders?.orders||[]).map(o=>`<div class="inventory-order-row"><div><strong>${esc(o.order_number||o.id?.slice(0,8)||"Bestellung")}</strong><small>${esc(o.supplier?.name||"Lieferant")} · ${o.lines?.length||0} Positionen</small></div><span class="inventory-status">${esc(invStatus(o.status))}</span><small>${o.expected_on?`Lieferung ${esc(o.expected_on)}`:""}</small>${["draft","ready","send_failed"].includes(o.status)?`<button class="btn outline" data-inv="send-order" data-id="${o.id}">Senden</button>`:"<span></span>"}</div>`).join("")||'<div class="inventory-empty">Noch keine Bestellung.</div>'}</article>`;
}

function inventoryReceiving(d){
  const orders=(d.orders?.orders||[]).filter(o=>["submitted","placed","delivered","partially_received"].includes(o.status));
  return`<article class="inventory-card"><div class="inventory-card-head"><h2>Wareneingang</h2></div>${orders.map(o=>`<div class="inventory-order-row"><div><strong>${esc(o.order_number||o.id?.slice(0,8))}</strong><small>${esc(o.supplier?.name||"")}</small></div><span class="inventory-status">${esc(invStatus(o.status))}</span><small>${o.expected_on||""}</small><button class="btn outline" data-inv="receive-order" data-id="${o.id}">Annehmen</button></div>`).join("")||'<div class="inventory-empty">Keine erwarteten Lieferungen.</div>'}</article>`;
}

app.addEventListener("click",e=>{
  const b=e.target.closest("[data-inv]");
  if(!b)return;
  if(b.dataset.inv==="tab"){
    S.inventoryTab=b.dataset.tab;
    renderAdmin();
  }else if(b.dataset.inv==="refresh"){
    delete S.inventoryPageCache[`${invKey()}:${S.inventoryTab}`];
    loadInventoryTab(true);
  }else if(b.dataset.inv==="autopilot-order"){
    S.inventoryOrderFocus={itemId:b.dataset.item,suggestedBaseQuantity:Number(b.dataset.suggested||0)};
    S.inventoryTab="orders";
    renderAdmin();
  }
});

app.addEventListener("input",e=>{
  const q=e.target.closest("[data-inv-stock-search]");
  if(!q)return;
  const needle=String(q.value||"").trim().toLocaleLowerCase("de-DE"),rows=[...app.querySelectorAll("[data-stock-row]")];
  let visible=0;
  rows.forEach(row=>{const show=!needle||String(row.dataset.stockSearch||"").includes(needle);row.hidden=!show;if(show)visible++});
  const empty=app.querySelector("[data-stock-empty]");
  if(empty)empty.hidden=visible!==0;
});
