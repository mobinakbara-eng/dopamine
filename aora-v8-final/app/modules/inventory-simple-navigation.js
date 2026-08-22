"use strict";

/*
 * Bestand is a navigation parent, not a page. The complete manager workflow is
 * intentionally split into only two destinations:
 *   - Bestellen: catalogue, suppliers, ordering, delivery receipt and counting
 *   - QR-Code: labels unlocked by a booked delivery, QR/MHD rules and scan access
 * Existing backend actions are reused; this module does not mutate data on load.
 */
S.inventorySection=["orders","qr"].includes(S.inventorySection)?S.inventorySection:"orders";
S.inventoryMenuOpen=Boolean(S.adminView==="inventory");
S.inventoryWorkspaceCache=S.inventoryWorkspaceCache||{};
S.inventoryWorkspaceNeedsRefresh=false;
S.inventoryWorkspaceLoading=S.inventoryWorkspaceLoading||{};

function inventoryWorkspaceKey(section){return`${invKey()}:workspace:${section}`}
function inventoryWorkspaceInvalidate(){S.inventoryWorkspaceCache={};S.inventoryWorkspaceNeedsRefresh=false}
function inventoryWorkspaceAvailability(){const a=invAvailability();if(!a)return{html:'<div class="inventory-card"><div class="inventory-empty">Zugriff wird geprüft …</div></div>'};if(!a.enabled)return{html:'<div class="inventory-card"><div class="inventory-empty">Bestand ist für diesen Standort nicht freigeschaltet.</div></div>'};return{a}}
function inventoryWorkspaceStatus(status){return invStatus(status||"")}
function inventoryWorkspaceIsReceivable(status){return["submitted","placed","delivered","partially_received"].includes(String(status||""))}
function inventoryWorkspaceIsOpen(status){return!["received","cancelled"].includes(String(status||""))}
function inventoryWorkspaceCategoryList(items){return[...new Set((items||[]).map(x=>String(x.category||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"de"))}
function inventoryWorkspaceSku(){return`AORA-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0,4).toUpperCase()}`}

async function loadInventoryWorkspace(section,force=false){
  if(S.adminView!=="inventory"||S.inventorySection!==section||!S.locationId)return;
  const key=inventoryWorkspaceKey(section),requestedLocationId=String(S.locationId),requestedSessionToken=String(S.session?.token||"");
  if(S.inventoryWorkspaceLoading[key])return S.inventoryWorkspaceLoading[key];
  if(S.inventoryWorkspaceCache[key]&&!force)return;
  const task=(async()=>{
    try{
      let data;
      if(section==="orders"){
        const[orders,suppliers,stock,replenishment]=await Promise.all([
          invRequest("listPurchaseOrders",{locationId:requestedLocationId}),
          invRequest("listSuppliers",{locationId:requestedLocationId}),
          invRequest("listStock",{locationId:requestedLocationId}),
          invRequest("listReplenishment",{locationId:requestedLocationId}).catch(()=>({suggestions:[]}))
        ]);
        data={orders,suppliers,stock,replenishment,loadedAt:Date.now()};
        // Existing send/receive modals read these canonical caches.
        S.inventoryPageCache[`${invKey()}:orders`]={orders,suppliers};
        S.inventoryPageCache[`${invKey()}:receiving`]={orders};
      }else{
        const[jobs,orders,insights]=await Promise.all([
          invRequest("listPrintJobs",{locationId:requestedLocationId}),
          invRequest("listPurchaseOrders",{locationId:requestedLocationId}),
          invRequest("listInventoryInsights",{locationId:requestedLocationId}).catch(()=>({summary:{},items:[]}))
        ]);
        data={jobs,orders,insights,loadedAt:Date.now()};
        S.inventoryPageCache[`${invKey()}:receiving`]={orders};
      }
      if(String(S.locationId)!==requestedLocationId||String(S.session?.token||"")!==requestedSessionToken||inventoryWorkspaceKey(section)!==key)return;
      S.inventoryWorkspaceCache[key]=data;
      if(S.adminView==="inventory"&&S.inventorySection===section)renderAdmin();
    }catch(error){
      if(String(S.locationId)!==requestedLocationId||String(S.session?.token||"")!==requestedSessionToken||inventoryWorkspaceKey(section)!==key)return;
      S.inventoryWorkspaceCache[key]={error:error.message,loadedAt:Date.now()};
      if(S.adminView==="inventory"&&S.inventorySection===section)renderAdmin();
    }finally{if(S.inventoryWorkspaceLoading[key]===task)delete S.inventoryWorkspaceLoading[key]}
  })();
  S.inventoryWorkspaceLoading[key]=task;
  return task;
}

function inventoryWorkspaceHeader(title,copy,actions=""){
  return`<div class="inventory-workspace-head"><div><div class="caps muted">Aora Bestand · ${esc(loc(S.locationId)?.name||"")}</div><h1>${esc(title)}</h1><p>${esc(copy)}</p></div>${actions?`<div class="inventory-workspace-head-actions">${actions}</div>`:""}</div>`;
}

function inventoryWorkspaceOrderCard(order){
  const receivable=inventoryWorkspaceIsReceivable(order.status),open=inventoryWorkspaceIsOpen(order.status),lines=order.lines||[],totalPacks=lines.reduce((sum,l)=>sum+Number(l.orderedPackQuantity||0),0),receivedBase=lines.reduce((sum,l)=>sum+Number(l.receivedQuantity||0),0),orderedBase=lines.reduce((sum,l)=>sum+Number(l.orderedQuantity||0),0);
  let action="";
  if(["draft","ready","send_failed"].includes(order.status))action=`<button class="btn outline" type="button" data-inv="send-order" data-id="${order.id}">Bestellung senden</button>`;
  else if(receivable)action=`<button class="btn" type="button" data-inventory-receive-order="${order.id}">Ware angekommen</button>`;
  else if(order.status==="received")action='<span class="inventory-workspace-done">✓ Eingelagert</span>';
  return`<article class="inventory-workspace-order ${open?"open":"done"}"><div class="inventory-workspace-order-main"><div><div class="inventory-workspace-order-top"><strong>${esc(order.order_number||order.id?.slice(0,8)||"Bestellung")}</strong><span class="inventory-status">${esc(inventoryWorkspaceStatus(order.status))}</span></div><h3>${esc(order.supplier?.name||"Lieferant")}</h3><p>${lines.length} Position${lines.length===1?"":"en"}${totalPacks?` · ${invNumber(totalPacks)} Packungen`:""}${order.expected_on?` · erwartet ${esc(invDate(order.expected_on))}`:""}</p>${receivedBase>0&&orderedBase>0?`<small>${invNumber(receivedBase)} / ${invNumber(orderedBase)} Basiseinheiten bereits angenommen</small>`:""}</div>${action}</div></article>`;
}

function inventoryWorkspaceProductRow(item){
  const low=Number(item.onHand)<=Number(item.reorderPoint||0),uom=invUom(item);
  return`<div class="inventory-workspace-product"><div class="inventory-workspace-product-icon material-symbols-rounded" aria-hidden="true">inventory_2</div><div><strong>${esc(item.name||"Artikel")}</strong><small>${esc([item.category,item.sku].filter(Boolean).join(" · "))}</small></div><div><small>Bestand</small><b>${invNumber(item.onHand)}${uom?` ${esc(uom)}`:""}</b></div><span class="inventory-status ${low?"low":"ok"}">${low?"Nachbestellen":"OK"}</span></div>`;
}

function inventoryWorkspaceSupplierCard(supplier){
  const c=supplier.contact||{};
  return`<button class="inventory-workspace-supplier" type="button" data-inv="suppliers"><div class="inventory-workspace-product-icon material-symbols-rounded" aria-hidden="true">local_shipping</div><span><strong>${esc(supplier.name)}</strong><small>${esc(c.email||c.whatsapp||"Kontakt hinterlegen")}</small></span><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></button>`;
}

function inventoryOrdersWorkspacePage(){
  const availability=inventoryWorkspaceAvailability();if(availability.html)return`<div class="inventory-shell">${availability.html}</div>`;
  const key=inventoryWorkspaceKey("orders"),data=S.inventoryWorkspaceCache[key];queueMicrotask(()=>loadInventoryWorkspace("orders",false));
  const header=inventoryWorkspaceHeader("Bestellen","Produkte anlegen, Lieferanten zuordnen, bestellen und eingehende Ware verbuchen.",'<button class="btn outline" type="button" data-inventory-action="product">+ Produkt</button><button class="btn" type="button" data-inv="new-order">Neue Bestellung</button>');
  if(!data)return`<div class="inventory-shell inventory-workspace">${header}<div class="inventory-card"><div class="inventory-empty">Bestand wird geladen …</div></div></div>`;
  if(data.error)return`<div class="inventory-shell inventory-workspace">${header}<div class="inventory-card"><div class="inventory-empty">${esc(data.error)}</div></div></div>`;
  const orders=data.orders?.orders||[],suppliers=data.suppliers?.suppliers||[],items=data.stock?.items||[],categories=inventoryWorkspaceCategoryList(items),openOrders=orders.filter(o=>inventoryWorkspaceIsOpen(o.status)),receivable=openOrders.filter(o=>inventoryWorkspaceIsReceivable(o.status)),suggestions=data.replenishment?.suggestions||[];
  return`<div class="inventory-shell inventory-workspace">${header}
    <div class="inventory-workspace-kpis">
      <div><strong>${items.length}</strong><span>Produkte</span></div><div><strong>${suppliers.length}</strong><span>Lieferanten</span></div><div><strong>${openOrders.length}</strong><span>offene Bestellungen</span></div><div class="${receivable.length?"attention":""}"><strong>${receivable.length}</strong><span>Lieferungen einbuchen</span></div>
    </div>
    ${suggestions.length?`<section class="inventory-workspace-panel inventory-workspace-attention"><div class="inventory-workspace-section-head"><div><span class="caps muted">Aora Autopilot</span><h2>${suggestions.length} Produkt${suggestions.length===1?"":"e"} nachbestellen</h2></div></div><p>Wähle ein Produkt. Aora übernimmt dessen offenen Bedarf und rundet erst danach auf Lieferanten-Packung, Mindestmenge und Bestellschritt.</p><div class="inventory-workspace-transfer-list">${suggestions.map(s=>{const item=items.find(i=>String(i.itemId||i.id)===String(s.item_id||s.itemId))||{},quantity=Number(s.suggestedQuantity??s.suggested_base_quantity??0);return`<article class="inventory-workspace-transfer-card suggested"><div class="inventory-workspace-product-icon material-symbols-rounded" aria-hidden="true">shopping_cart</div><div><strong>${esc(item.name||"Produkt")}</strong><small>${invNumber(quantity)}${invUom(item)?` ${esc(invUom(item))}`:""} werden benötigt.</small></div><button class="btn" type="button" data-inv="new-order" data-order-focus-item="${esc(s.item_id||s.itemId)}" data-order-focus-quantity="${quantity}">Bestellung vorbereiten</button></article>`}).join("")}</div></section>`:""}
    <section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Bestellung → Wareneingang</span><h2>Bestellungen</h2><p>Wenn die Lieferung da ist, hier „Ware angekommen“ wählen. Erst dann wird der Bestand erhöht und QR-Druck wird freigeschaltet.</p></div><button class="btn outline" type="button" data-inv="ordering-profile">Absenderdaten</button></div><div class="inventory-workspace-orders">${orders.length?orders.slice(0,40).map(inventoryWorkspaceOrderCard).join(""):'<div class="inventory-empty">Noch keine Bestellung. Lege zuerst Produkte und einen Lieferanten an.</div>'}</div></section>
    <section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Stammdaten</span><h2>Produkte & Kategorien</h2><p>Ein Produkt enthält Kategorie, Basiseinheit, Meldebestand und seine echte Verpackung. Neue Kategorien entstehen automatisch mit dem Produkt.</p></div><div class="inventory-actions"><button class="btn outline" type="button" data-inv="start-count">Bestand zählen</button><button class="btn" type="button" data-inventory-action="product">+ Produkt</button></div></div>${categories.length?`<div class="inventory-workspace-categories">${categories.map(c=>`<span>${esc(c)}</span>`).join("")}</div>`:""}<div class="inventory-workspace-products">${items.length?items.map(inventoryWorkspaceProductRow).join(""):'<div class="inventory-empty">Noch keine Produkte. Mit „+ Produkt“ legst du Artikel, Kategorie und Kartoninhalt in einem Schritt an.</div>'}</div></section>
    <section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Beschaffung</span><h2>Lieferanten</h2><p>Produkte werden dem Lieferanten mit dessen SKU, Preis, Verpackung und Mindestmenge zugeordnet.</p></div><button class="btn" type="button" data-inv="suppliers">Lieferanten verwalten</button></div><div class="inventory-workspace-suppliers">${suppliers.length?suppliers.map(inventoryWorkspaceSupplierCard).join(""):'<div class="inventory-empty">Noch kein Lieferant hinterlegt.</div>'}</div></section>
  </div>`;
}

function inventoryQrJobCard(job){
  const prepared=job.status==="prepared";
  return`<article class="inventory-workspace-qr-job"><div class="inventory-workspace-product-icon material-symbols-rounded" aria-hidden="true">qr_code_2</div><div><strong>${esc(job.item?.name||"Artikel")}</strong><small>${invNumber(job.labelCount,0)} Etikett${Number(job.labelCount)===1?"":"en"}${job.lotCode?` · Charge ${esc(job.lotCode)}`:""}${job.expiresOn?` · MHD ${esc(invDate(job.expiresOn))}`:""}</small><span class="inventory-status ${prepared?"":"ok"}">${prepared?"Vorbereitet":"Druckbereit"}</span></div><button class="btn" type="button" data-inventory-print-job="${job.id}">${prepared?"QR öffnen":"QR erstellen & drucken"}</button></article>`;
}

function inventoryQrLockedOrder(order){
  return`<article class="inventory-workspace-qr-locked"><span class="material-symbols-rounded" aria-hidden="true">lock</span><div><strong>${esc(order.supplier?.name||"Lieferung")}</strong><small>${esc(order.order_number||order.id?.slice(0,8)||"")} · ${esc(inventoryWorkspaceStatus(order.status))}</small></div><span>Wartet auf Wareneingang</span></article>`;
}

function inventoryQrWorkspacePage(){
  const availability=inventoryWorkspaceAvailability();if(availability.html)return`<div class="inventory-shell">${availability.html}</div>`;
  const key=inventoryWorkspaceKey("qr"),data=S.inventoryWorkspaceCache[key];queueMicrotask(()=>loadInventoryWorkspace("qr",false));
  const header=inventoryWorkspaceHeader("QR-Code","QR-Etiketten werden aus echten Wareneingängen erzeugt. Keine Ware wird hier zusätzlich eingebucht.",'<button class="btn outline" type="button" data-inventory-refresh>Aktualisieren</button>');
  if(!data)return`<div class="inventory-shell inventory-workspace">${header}<div class="inventory-card"><div class="inventory-empty">QR-Aufträge werden geladen …</div></div></div>`;
  if(data.error)return`<div class="inventory-shell inventory-workspace">${header}<div class="inventory-card"><div class="inventory-empty">${esc(data.error)}</div></div></div>`;
  const jobs=data.jobs?.jobs||[],orders=data.orders?.orders||[],locked=orders.filter(o=>inventoryWorkspaceIsReceivable(o.status)),summary=data.insights?.summary||{},canWaste=Boolean(availability.a?.permissions?.waste);
  return`<div class="inventory-shell inventory-workspace">${header}
    <div class="inventory-workspace-flow"><div><span>1</span><strong>Bestellen</strong><small>Bestellung anlegen</small></div><b>→</b><div><span>2</span><strong>Ware angekommen</strong><small>Wareneingang prüfen</small></div><b>→</b><div class="active"><span>3</span><strong>QR drucken</strong><small>erst jetzt freigeschaltet</small></div></div>
    <section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Zum Drucken</span><h2>${jobs.length?`${jobs.length} QR-Auftrag${jobs.length===1?"":"e"} bereit`:"Keine QR-Etiketten offen"}</h2><p>${jobs.length?"Diese Etiketten stammen aus bereits gebuchtem Wareneingang.":"Sobald du unter Bestellen eine Lieferung als angekommen buchst, erscheint der QR-Druck hier automatisch."}</p></div></div><div class="inventory-workspace-qr-jobs">${jobs.length?jobs.map(inventoryQrJobCard).join(""):'<div class="inventory-workspace-qr-empty"><span class="material-symbols-rounded">qr_code_2</span><strong>Noch nichts zu drucken.</strong><small>Keine zusätzliche Bestandsbuchung nötig.</small></div>'}</div></section>
    ${locked.length?`<section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Noch gesperrt</span><h2>${locked.length} Lieferung${locked.length===1?"":"en"} wartet${locked.length===1?"":"en"}</h2><p>Diese Bestellungen erzeugen erst nach bestätigtem Wareneingang QR-Etiketten.</p></div><button class="btn outline" type="button" data-inventory-route="orders">Zu Bestellen</button></div><div class="inventory-workspace-qr-locked-list">${locked.map(inventoryQrLockedOrder).join("")}</div></section>`:""}
    <section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">QR Verwaltung</span><h2>Regeln & Zugriff</h2><p>Diese Einstellungen gelten nur für die QR-Nutzung; Bestellungen bleiben im Bereich Bestellen.</p></div></div><div class="inventory-workspace-tool-grid"><button type="button" data-inv="qr-rules"><span class="material-symbols-rounded">deployed_code</span><strong>QR-Regeln</strong><small>Ganzes oder angebrochenes Pack</small></button><button type="button" data-inv="expiry-rules"><span class="material-symbols-rounded">event</span><strong>MHD & FEFO</strong><small>Haltbarkeit pro Produkt</small></button><button type="button" data-inv="employee-access"><span class="material-symbols-rounded">badge</span><strong>Scan-Zugriff</strong><small>Mitarbeiter freigeben</small></button>${canWaste?`<button type="button" data-inv="expired-review"><span class="material-symbols-rounded">delete_sweep</span><strong>Abgelaufen prüfen</strong><small>${Number(summary.expiredItemCount||0)} Artikel aktuell markiert</small></button>`:""}</div></section>
  </div>`;
}

async function inventoryProductModal(){
  const data=S.inventoryWorkspaceCache[inventoryWorkspaceKey("orders")],categories=inventoryWorkspaceCategoryList(data?.stock?.items||[]),suppliers=data?.suppliers?.suppliers||[];
  const listId=`inventory-category-${crypto.randomUUID().slice(0,8)}`;
  const d=modal(`${modalHeader("Bestellen","Neues Produkt")}<form class="form-grid inventory-product-create" id="inventory-product-create"><div class="field full inventory-smart-note"><strong>Produkt + Verpackung in einem Schritt</strong><span>Die Verpackung bestimmt später Bestellmenge und QR-Etiketten. Ein QR-Druck wird erst nach echtem Wareneingang freigeschaltet.</span></div><div class="field full"><label>Produktname</label><input class="input" name="name" maxlength="160" required placeholder="z. B. Oatly Barista"></div><div class="field"><label>Kategorie</label><input class="input" name="category" list="${listId}" maxlength="100" placeholder="z. B. Milch & Alternativen"><datalist id="${listId}">${categories.map(c=>`<option value="${esc(c)}"></option>`).join("")}</datalist><small>Neue Eingabe = neue Kategorie.</small></div><div class="field"><label>SKU</label><input class="input" name="sku" maxlength="80" placeholder="optional · Aora erzeugt sonst eine"></div><div class="field"><label>Barcode</label><input class="input" name="barcode" maxlength="120" inputmode="numeric" placeholder="optional"></div><div class="field"><label>Basiseinheit</label><select class="select" name="baseUom"><option value="piece">Stück</option><option value="l">Liter</option><option value="ml">ml</option><option value="kg">kg</option><option value="g">g</option><option value="pack">Pack</option><option value="box">Box</option></select></div><div class="field"><label>Meldebestand</label><input class="input" name="reorderPoint" type="number" min="0" step="0.001" value="0"></div><div class="field"><label>Verpackung</label><input class="input" name="packLabel" maxlength="100" required value="Karton"></div><div class="field"><label>Inhalt pro Verpackung</label><input class="input" name="baseQuantity" type="number" min="0.001" step="0.001" required value="1"><small>z. B. 6 = 6 Basiseinheiten pro Karton.</small></div><div class="field full inventory-product-options"><label><input type="checkbox" name="orderUnit" checked> Diese Verpackung ist die Bestelleinheit</label><label><input type="checkbox" name="stockUnit" checked> Pro Verpackung später einen QR-Code erzeugen</label></div><div class="field full"><label>Lieferant zuordnen</label><select class="select" name="supplierId"><option value="">Später zuordnen</option>${suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div><div class="field"><label>Preis pro Verpackung</label><input class="input" name="unitPrice" type="number" min="0" step="0.01" placeholder="optional"></div><div class="field"><label>Minimum dieses Produkts</label><input class="input" name="minimumOrderQuantity" type="number" min="0.001" step="0.001" value="1"></div><div class="field"><label>Bestellschritt</label><input class="input" name="orderMultiple" type="number" min="0.001" step="0.001" value="1"></div><div class="field"><label>Lieferanten-SKU</label><input class="input" name="supplierSku" maxlength="120" placeholder="optional"></div><div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Produkt anlegen</button></div></form>`);
  const form=d.querySelector("#inventory-product-create");
  const creationKey=crypto.randomUUID(),packCodeSuffix=crypto.randomUUID().slice(0,4).toUpperCase();
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(!form.reportValidity())return;const f=new FormData(form),submit=form.querySelector('button[type="submit"]'),name=String(f.get("name")||"").trim(),sku=String(f.get("sku")||"").trim()||inventoryWorkspaceSku(),baseQuantity=Number(f.get("baseQuantity")),minimum=Number(f.get("minimumOrderQuantity")),multiple=Number(f.get("orderMultiple"));
    if(!(baseQuantity>0))return toast("Inhalt pro Verpackung muss größer als 0 sein.","error");if(!(minimum>0)||!(multiple>0))return toast("Mindestmenge und Bestellschritt müssen größer als 0 sein.","error");
    submit.disabled=true;submit.textContent="Produkt wird angelegt …";
    try{
      const packLabel=String(f.get("packLabel")||"Karton").trim(),packCode=(packLabel.replace(/[^A-Za-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,28)||"PACK")+"-"+packCodeSuffix;
      await invRequest("createProductBundle",{locationId:S.locationId,name,sku,barcode:f.get("barcode")||"",baseUom:f.get("baseUom")||"piece",category:f.get("category")||"",reorderPoint:Number(f.get("reorderPoint")||0),packCode,packLabel,baseQuantity,isStockUnit:f.get("stockUnit")!==null,isOrderUnit:f.get("orderUnit")!==null,supplierId:String(f.get("supplierId")||"")||null,supplierSku:f.get("supplierSku")||"",unitPrice:f.get("unitPrice")||null,currency:"EUR",minimumOrderQuantity:minimum,orderMultiple:multiple,idempotencyKey:creationKey});
      d.remove();inventoryWorkspaceInvalidate();S.inventoryPageCache={};toast("Produkt, Kategorie und Verpackung wurden angelegt.");renderAdmin();
    }catch(error){toast(error.message,"error");submit.disabled=false;submit.textContent="Erneut versuchen"}
  });
}

async function inventoryOpenPrintJob(jobId){
  const data=S.inventoryWorkspaceCache[inventoryWorkspaceKey("qr")],job=(data?.jobs?.jobs||[]).find(j=>String(j.id)===String(jobId));if(!job)return toast("QR-Auftrag bitte aktualisieren.","error");
  const dialog=modal(`${modalHeader("QR-Code",esc(job.item?.name||"Etiketten"))}<div id="qr-manager-body"><div class="inventory-empty">QR wird vorbereitet …</div></div>`);
  try{dialog._aoraQrProfile=await invRequest("getPrintProfile",{locationId:S.locationId});await prepareExistingPrintJob(dialog,job)}catch(error){dialog.querySelector("#qr-manager-body").innerHTML=`<div class="inventory-empty">${esc(error.message)}</div>`}
  dialog.addEventListener("click",async event=>{
    const action=event.target.closest("[data-qr-action]");if(!action)return;
    if(action.dataset.qrAction==="print"){printQrBatch({...dialog._aoraQrBatch,profile:dialog._aoraQrProfile},dialog._aoraQrItemName);return}
    if(action.dataset.qrAction==="confirm"){
      action.disabled=true;try{await invRequest("confirmPrintJob",{locationId:S.locationId,printJobId:action.dataset.jobId});dialog.remove();inventoryWorkspaceInvalidate();S.inventoryPageCache={};toast("QR-Etiketten sind aktiv.");renderAdmin()}catch(error){toast(error.message,"error");action.disabled=false}
    }
  });
}

function decorateInventorySubnav(){
  const nav=app.querySelector?.(".admin-nav");if(!nav)return;const parent=nav.querySelector('[data-a="admin-view"][data-view="inventory"]');nav.querySelectorAll(".inventory-subnav").forEach(node=>node.remove());if(!parent)return;
  parent.classList.add("inventory-parent-nav");parent.setAttribute("aria-haspopup","true");const open=Boolean(S.inventoryMenuOpen||S.adminView==="inventory");parent.setAttribute("aria-expanded",open?"true":"false");
  let chevron=parent.querySelector(".inventory-parent-chevron");if(!chevron){chevron=document.createElement("span");chevron.className="material-symbols-rounded inventory-parent-chevron";chevron.setAttribute("aria-hidden","true");parent.appendChild(chevron)}chevron.textContent=open?"expand_less":"expand_more";
  if(!open)return;
  const wrap=document.createElement("div");wrap.className="inventory-subnav";wrap.setAttribute("aria-label","Bestand Untermenü");const qrActive=S.adminView==="inventory"&&S.inventorySection==="qr",ordersActive=S.adminView==="inventory"&&S.inventorySection==="orders";wrap.innerHTML=`<button type="button" class="inventory-subnav-button ${qrActive?"active":""}" data-inventory-route="qr"><span class="material-symbols-rounded" aria-hidden="true">qr_code_scanner</span><span>QR-Code</span></button><button type="button" class="inventory-subnav-button ${ordersActive?"active":""}" data-inventory-route="orders"><span class="material-symbols-rounded" aria-hidden="true">shopping_bag</span><span>Bestellen</span></button>`;parent.insertAdjacentElement("afterend",wrap);
}

const _inventoryWorkspaceRenderAdmin=renderAdmin;
renderAdmin=function(){
  if(S.adminView==="inventory"&&S.inventoryWorkspaceNeedsRefresh){inventoryWorkspaceInvalidate()}
  _inventoryWorkspaceRenderAdmin();decorateInventorySubnav();
};
const _inventoryWorkspaceAdminTitle=adminTitle;
adminTitle=function(){if(S.adminView==="inventory")return S.inventorySection==="qr"?"QR-Code":"Bestellen";return _inventoryWorkspaceAdminTitle()};
const _inventoryWorkspaceAdminView=adminView;
adminView=function(){if(S.adminView==="inventory")return S.inventorySection==="qr"?inventoryQrWorkspacePage():inventoryOrdersWorkspacePage();return _inventoryWorkspaceAdminView()};

app.addEventListener("click",event=>{
  const parent=event.target.closest?.('[data-a="admin-view"][data-view="inventory"]');
  if(parent){event.preventDefault();event.stopImmediatePropagation();S.inventoryMenuOpen=!S.inventoryMenuOpen;decorateInventorySubnav();return}
  const other=event.target.closest?.('[data-a="admin-view"]');if(other&&other.dataset.view!=="inventory")S.inventoryMenuOpen=false;
  const route=event.target.closest?.("[data-inventory-route]");
  if(route){event.preventDefault();event.stopImmediatePropagation();S.inventorySection=route.dataset.inventoryRoute==="qr"?"qr":"orders";S.adminView="inventory";S.inventoryMenuOpen=true;renderAdmin();document.getElementById("aside")?.classList.remove("open");return}
  const product=event.target.closest?.('[data-inventory-action="product"]');if(product){event.preventDefault();inventoryProductModal();return}
  const receive=event.target.closest?.("[data-inventory-receive-order]");if(receive){event.preventDefault();S.inventoryWorkspaceNeedsRefresh=true;receiveOrderModal(receive.dataset.inventoryReceiveOrder);return}
  const print=event.target.closest?.("[data-inventory-print-job]");if(print){event.preventDefault();inventoryOpenPrintJob(print.dataset.inventoryPrintJob);return}
  const refresh=event.target.closest?.("[data-inventory-refresh]");if(refresh){event.preventDefault();delete S.inventoryWorkspaceCache[inventoryWorkspaceKey(S.inventorySection)];loadInventoryWorkspace(S.inventorySection,true);return}
  const inventoryAction=event.target.closest?.("[data-inv]");if(inventoryAction&&["new-order","send-order","suppliers","ordering-profile","start-count","qr-rules","expiry-rules","employee-access","expired-review"].includes(inventoryAction.dataset.inv))S.inventoryWorkspaceNeedsRefresh=true;
  if(inventoryAction?.dataset.inv==="new-order"&&inventoryAction.dataset.orderFocusItem){S.inventoryOrderFocus={itemId:String(inventoryAction.dataset.orderFocusItem),suggestedBaseQuantity:Math.max(0,Number(inventoryAction.dataset.orderFocusQuantity)||0)}}
},true);
