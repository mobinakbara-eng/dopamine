"use strict";

S.inventorySection=S.inventorySection||"home";

function inventorySimpleChoicePage(){
  const a=invAvailability();
  if(!a)return`<div class="inventory-shell"><div class="inventory-card"><div class="inventory-empty">Zugriff wird geprüft …</div></div></div>`;
  if(!a.enabled)return`<div class="inventory-shell"><div class="inventory-card"><div class="inventory-empty">Bestand ist für diesen Standort nicht freigeschaltet.</div></div></div>`;
  return`<div class="inventory-shell inventory-simple-home">
    <div class="inventory-head inventory-simple-head">
      <div><div class="caps muted">Aora Bestand · ${esc(loc(S.locationId)?.name||"")}</div><h1>Bestand</h1><p>Wähle, was du machen möchtest.</p></div>
    </div>
    <div class="inventory-choice-grid" role="list" aria-label="Bestand Bereiche">
      <button class="inventory-choice-card" type="button" data-inventory-route="qr" role="listitem">
        <span class="inventory-choice-icon material-symbols-rounded" aria-hidden="true">qr_code_scanner</span>
        <span class="inventory-choice-copy"><strong>QR-Code</strong><small>QR-Etiketten erstellen, drucken und verwalten.</small></span>
        <span class="inventory-choice-arrow" aria-hidden="true">→</span>
      </button>
      <button class="inventory-choice-card" type="button" data-inventory-route="orders" role="listitem">
        <span class="inventory-choice-icon material-symbols-rounded" aria-hidden="true">shopping_bag</span>
        <span class="inventory-choice-copy"><strong>Bestellen</strong><small>Lieferanten, Artikel und Bestellungen verwalten.</small></span>
        <span class="inventory-choice-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  </div>`;
}

function inventorySimpleOrdersPage(){
  const a=invAvailability();
  if(!a)return`<div class="inventory-shell"><div class="inventory-card"><div class="inventory-empty">Zugriff wird geprüft …</div></div></div>`;
  if(!a.enabled)return`<div class="inventory-shell"><div class="inventory-card"><div class="inventory-empty">Bestand ist für diesen Standort nicht freigeschaltet.</div></div></div>`;
  S.inventoryTab="orders";
  const key=`${invKey()}:orders`,cached=S.inventoryPageCache[key];
  queueMicrotask(()=>loadInventoryTab(false));
  return`<div class="inventory-shell inventory-simple-orders">
    <div class="inventory-head inventory-simple-head">
      <div><button class="inventory-simple-back" type="button" data-inventory-route="home">← Bestand</button><div class="caps muted">Aora Bestand · ${esc(loc(S.locationId)?.name||"")}</div><h1>Bestellen</h1><p>Lieferanten auswählen, Produkte zuordnen und Bestellungen vorbereiten.</p></div>
      <div class="inventory-actions"><button class="btn outline" data-inv="refresh">Aktualisieren</button><button class="btn" data-inv="new-order">Neue Bestellung</button></div>
    </div>
    ${cached?renderInventoryTab(cached):'<div class="inventory-card"><div class="inventory-empty">Bestellungen werden geladen …</div></div>'}
  </div>`;
}

function decorateInventorySubnav(){
  const nav=app.querySelector?.(".admin-nav");
  if(!nav)return;
  const parent=nav.querySelector('[data-a="admin-view"][data-view="inventory"]');
  nav.querySelectorAll(".inventory-subnav").forEach(node=>node.remove());
  if(!parent)return;
  parent.classList.add("inventory-parent-nav");
  const wrap=document.createElement("div");
  wrap.className="inventory-subnav";
  wrap.setAttribute("aria-label","Bestand Untermenü");
  const qrActive=S.adminView==="inventory"&&S.inventorySection==="qr";
  const ordersActive=S.adminView==="inventory"&&S.inventorySection==="orders";
  wrap.innerHTML=`<button type="button" class="inventory-subnav-button ${qrActive?"active":""}" data-inventory-route="qr"><span class="material-symbols-rounded" aria-hidden="true">qr_code_scanner</span><span>QR-Code</span></button><button type="button" class="inventory-subnav-button ${ordersActive?"active":""}" data-inventory-route="orders"><span class="material-symbols-rounded" aria-hidden="true">shopping_bag</span><span>Bestellen</span></button>`;
  parent.insertAdjacentElement("afterend",wrap);
}

const _inventorySimpleRenderAdmin=renderAdmin;
renderAdmin=function(){
  _inventorySimpleRenderAdmin();
  decorateInventorySubnav();
};

const _inventorySimpleAdminTitle=adminTitle;
adminTitle=function(){
  if(S.adminView==="inventory")return S.inventorySection==="orders"?"Bestellen":"Bestand";
  return _inventorySimpleAdminTitle();
};

const _inventorySimpleAdminView=adminView;
adminView=function(){
  if(S.adminView==="inventory")return S.inventorySection==="orders"?inventorySimpleOrdersPage():inventorySimpleChoicePage();
  return _inventorySimpleAdminView();
};

app.addEventListener("click",event=>{
  const parent=event.target.closest?.('[data-a="admin-view"][data-view="inventory"]');
  if(parent){S.inventorySection="home";return}
  const target=event.target.closest?.("[data-inventory-route]");
  if(!target)return;
  event.preventDefault();
  event.stopPropagation();
  const route=target.dataset.inventoryRoute;
  S.adminView="inventory";
  if(route==="home"){
    S.inventorySection="home";
    renderAdmin();
    return;
  }
  if(route==="orders"){
    S.inventorySection="orders";
    S.inventoryTab="orders";
    renderAdmin();
    return;
  }
  if(route==="qr"){
    S.inventorySection="qr";
    renderAdmin();
    queueMicrotask(()=>qrManagerModal());
  }
},true);
