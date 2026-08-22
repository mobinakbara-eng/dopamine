"use strict";

/*
 * Manager catalog UX:
 * - products stay behind categories by default
 * - only Meldebestand exceptions surface products without a category click
 * - supplier mapping is multi-select
 * - item/supplier photos live in a private bucket and are exposed via signed URLs
 */
S.inventorySelectedCategory=S.inventorySelectedCategory||null;

function inventoryCatalogItemId(item){return String(item?.itemId||item?.id||"")}
function inventoryCatalogCategory(item){return String(item?.category||"").trim()||"Ohne Kategorie"}
function inventoryCatalogMediaMap(data,kind){
  const rows=data?.catalogMedia?.[kind]||[];
  return new Map(rows.map(x=>[String(x.id),x.url||""]));
}
function inventoryCatalogPhoto(url,alt,kind,id){
  return`<button class="inventory-catalog-photo ${url?"has-photo":""}" type="button" data-inventory-photo-kind="${kind}" data-inventory-photo-id="${esc(id)}" aria-label="Foto für ${esc(alt)} ${url?"ändern":"hinzufügen"}">${url?`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`:'<span class="material-symbols-rounded" aria-hidden="true">add_a_photo</span>'}</button>`;
}
async function inventoryMediaRequest(action,body={}){
  if(!S.session?.token)throw new Error("Bitte erneut anmelden.");
  return request("aora-v8-inventory-media",{action,...body,sessionToken:S.session.token});
}
async function inventoryCatalogEnsureMedia(data,force=false){
  if(!data||data.error||data.catalogMediaLoading||(!force&&data.catalogMediaLoaded))return;
  data.catalogMediaLoading=true;
  try{
    const items=data.stock?.items||[],suppliers=data.suppliers?.suppliers||[];
    data.catalogMedia=await inventoryMediaRequest("listInventoryMedia",{
      locationId:S.locationId,
      itemIds:items.map(inventoryCatalogItemId).filter(Boolean),
      supplierIds:suppliers.map(x=>x.id).filter(Boolean)
    });
    data.catalogMediaLoaded=true;
  }catch(error){
    data.catalogMedia={items:[],suppliers:[]};
    data.catalogMediaError=error.message;
  }finally{data.catalogMediaLoading=false}
  if(S.adminView==="inventory"&&S.inventorySection==="orders")renderAdmin();
}

async function inventoryUploadCatalogPhoto(kind,entityId,file){
  if(!file)return;
  if(!["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(String(file.type||"").toLowerCase()))throw new Error("Bitte JPG, PNG, WebP, HEIC oder HEIF verwenden.");
  if(file.size<=0||file.size>8*1024*1024)throw new Error("Das Bild darf höchstens 8 MB groß sein.");
  const prep=await inventoryMediaRequest("prepareInventoryImageUpload",{locationId:S.locationId,kind,entityId,mimeType:file.type,size:file.size});
  if(!window.supabase?.createClient)throw new Error("Foto-Upload ist gerade nicht verfügbar.");
  const client=window.supabase.createClient(CFG.url,CFG.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const{error}=await client.storage.from(prep.bucket).uploadToSignedUrl(prep.path,prep.token,file,{contentType:file.type,upsert:false});
  if(error)throw new Error(error.message||"Foto konnte nicht hochgeladen werden.");
  await inventoryMediaRequest("confirmInventoryImageUpload",{locationId:S.locationId,kind,entityId,path:prep.path});
}
function inventoryChooseCatalogPhoto(kind,entityId){
  const input=document.createElement("input");
  input.type="file";input.accept="image/jpeg,image/png,image/webp,image/heic,image/heif";input.setAttribute("capture","environment");
  input.addEventListener("change",async()=>{
    const file=input.files?.[0];if(!file)return;
    try{
      toast("Foto wird gespeichert …");
      await inventoryUploadCatalogPhoto(kind,entityId,file);
      const data=S.inventoryWorkspaceCache[inventoryWorkspaceKey("orders")];if(data){data.catalogMediaLoaded=false;await inventoryCatalogEnsureMedia(data,true)}
      toast("Foto gespeichert.");renderAdmin();
    }catch(error){toast(error.message,"error")}
  },{once:true});
  input.click();
}

function inventoryCatalogDangerRows(data){
  const items=data.stock?.items||[],suggestions=data.replenishment?.suggestions||[],byId=new Map(items.map(x=>[inventoryCatalogItemId(x),x]));
  return suggestions.map(s=>{const item=byId.get(String(s.item_id||s.itemId||""));if(!item)return"";const id=inventoryCatalogItemId(item),uom=invUom(item),photo=inventoryCatalogMediaMap(data,"items").get(id)||"";return`<article class="inventory-danger-item">${inventoryCatalogPhoto(photo,item.name||"Artikel","item",id)}<div><strong>${esc(item.name||"Artikel")}</strong><small>${esc(inventoryCatalogCategory(item))} · Bestand ${invNumber(item.onHand)}${uom?` ${esc(uom)}`:""} · Meldebestand ${invNumber(item.reorderPoint||0)}</small><span>Aora empfiehlt ${invNumber(s.suggestedQuantity??s.suggested_base_quantity??0)}${uom?` ${esc(uom)}`:""}</span></div><button class="btn" type="button" data-inventory-danger-order="${esc(id)}" data-inventory-danger-qty="${Number(s.suggestedQuantity??s.suggested_base_quantity??0)}">Bestellen</button></article>`}).join("");
}
function inventoryCatalogCategoryCards(data){
  const items=data.stock?.items||[],suggestions=data.replenishment?.suggestions||[],danger=new Set(suggestions.map(s=>String(s.item_id||s.itemId||""))),groups=new Map();
  for(const item of items){const c=inventoryCatalogCategory(item);if(!groups.has(c))groups.set(c,[]);groups.get(c).push(item)}
  return[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"de")).map(([name,rows])=>{const risky=rows.filter(x=>danger.has(inventoryCatalogItemId(x))).length;return`<button class="inventory-category-card" type="button" data-inventory-category="${esc(name)}"><span class="inventory-category-icon material-symbols-rounded" aria-hidden="true">folder</span><span><strong>${esc(name)}</strong><small>${rows.length} Artikel${risky?` · ${risky} im Meldebestand`:""}</small></span><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></button>`}).join("");
}
function inventoryCatalogProductRowV2(item,data){
  const id=inventoryCatalogItemId(item),uom=invUom(item),low=Number(item.onHand)<=Number(item.reorderPoint||0),photo=inventoryCatalogMediaMap(data,"items").get(id)||"";
  return`<article class="inventory-catalog-product-row">${inventoryCatalogPhoto(photo,item.name||"Artikel","item",id)}<div class="inventory-catalog-product-copy"><strong>${esc(item.name||"Artikel")}</strong><small>${esc(item.sku||"")}${item.barcode?` · ${esc(item.barcode)}`:""}</small></div><div class="inventory-catalog-stock"><small>Bestand</small><b>${invNumber(item.onHand)}${uom?` ${esc(uom)}`:""}</b></div><span class="inventory-status ${low?"low":"ok"}">${low?"Meldebestand":"OK"}</span></article>`;
}
function inventoryCatalogMasterSection(data){
  const items=data.stock?.items||[],categories=[...new Set(items.map(inventoryCatalogCategory))].sort((a,b)=>a.localeCompare(b,"de"));
  if(S.inventorySelectedCategory&&!categories.includes(S.inventorySelectedCategory))S.inventorySelectedCategory=null;
  const selected=S.inventorySelectedCategory,rows=selected?items.filter(x=>inventoryCatalogCategory(x)===selected):[];
  return`<section class="inventory-workspace-panel inventory-catalog-master"><div class="inventory-workspace-section-head"><div><span class="caps muted">Stammdaten</span><h2>${selected?esc(selected):"Kategorien"}</h2><p>${selected?"Nur Artikel dieser Kategorie werden angezeigt.":"Artikel bleiben übersichtlich in Kategorien. Öffne eine Kategorie, um ihre Produkte zu sehen."}</p></div><div class="inventory-actions">${selected?'<button class="btn outline" type="button" data-inventory-category-back>← Kategorien</button>':'<button class="btn outline" type="button" data-inv="start-count">Bestand zählen</button>'}<button class="btn" type="button" data-inventory-action="product">+ Produkt</button></div></div>${selected?`<div class="inventory-catalog-products">${rows.length?rows.map(x=>inventoryCatalogProductRowV2(x,data)).join(""):'<div class="inventory-empty">Keine Artikel in dieser Kategorie.</div>'}</div>`:`<div class="inventory-category-grid">${items.length?inventoryCatalogCategoryCards(data):'<div class="inventory-empty">Noch keine Produkte. Mit „+ Produkt“ legst du Produkt, Kategorie und Verpackung an.</div>'}</div>`}</section>`;
}
function inventoryCatalogSupplierCard(supplier,data){
  const c=supplier.contact||{},photo=inventoryCatalogMediaMap(data,"suppliers").get(String(supplier.id))||"";
  return`<button class="inventory-workspace-supplier inventory-supplier-card-v2" type="button" data-inv="suppliers">${photo?`<img src="${esc(photo)}" alt="${esc(supplier.name)}" loading="lazy">`:'<span class="inventory-workspace-product-icon material-symbols-rounded" aria-hidden="true">local_shipping</span>'}<span><strong>${esc(supplier.name)}</strong><small>${esc(c.email||c.whatsapp||"Kontakt hinterlegen")}</small></span><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></button>`;
}

// Final composition after inventory-workspace-transfer.js: keep Transfer Before Buy,
// but replace the flat product dump with category-first catalog navigation.
inventoryOrdersWorkspacePage=function(){
  const availability=inventoryWorkspaceAvailability();if(availability.html)return`<div class="inventory-shell">${availability.html}</div>`;
  const key=inventoryWorkspaceKey("orders"),data=S.inventoryWorkspaceCache[key];queueMicrotask(()=>loadInventoryWorkspace("orders",false));
  const header=inventoryWorkspaceHeader("Bestellen","Kategorien, Lieferanten, Bestellungen und Wareneingang an einem Ort.",'<button class="btn outline" type="button" data-inventory-action="product">+ Produkt</button><button class="btn" type="button" data-inv="new-order">Neue Bestellung</button>');
  if(!data)return`<div class="inventory-shell inventory-workspace">${header}<div class="inventory-card"><div class="inventory-empty">Bestand wird geladen …</div></div></div>`;
  if(data.error)return`<div class="inventory-shell inventory-workspace">${header}<div class="inventory-card"><div class="inventory-empty">${esc(data.error)}</div></div></div>`;
  queueMicrotask(()=>inventoryCatalogEnsureMedia(data,false));
  if(typeof loadInventoryWorkspaceTransfers==="function")queueMicrotask(()=>loadInventoryWorkspaceTransfers(false));
  const orders=data.orders?.orders||[],suppliers=data.suppliers?.suppliers||[],items=data.stock?.items||[],openOrders=orders.filter(x=>inventoryWorkspaceIsOpen(x.status)),receivable=orders.filter(x=>inventoryWorkspaceIsReceivable(x.status)),suggestions=data.replenishment?.suggestions||[],dangerRows=inventoryCatalogDangerRows(data),transferSection=typeof inventoryWorkspaceTransferSection==="function"?inventoryWorkspaceTransferSection(data):"";
  return`<div class="inventory-shell inventory-workspace">${header}
    <div class="inventory-workspace-kpis"><div><strong>${items.length}</strong><span>Produkte</span></div><div><strong>${suppliers.length}</strong><span>Lieferanten</span></div><div><strong>${openOrders.length}</strong><span>offene Bestellungen</span></div><div class="${receivable.length?"attention":""}"><strong>${receivable.length}</strong><span>Lieferungen einbuchen</span></div></div>
    ${suggestions.length?`<section class="inventory-workspace-panel inventory-workspace-attention inventory-melde-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Meldebestand</span><h2>${suggestions.length} Artikel brauchen Aufmerksamkeit</h2><p>Nur hier zeigt Aora einzelne Artikel sofort, weil ihr Bestand den kritischen Bereich erreicht hat.</p></div></div><div class="inventory-danger-list">${dangerRows||'<div class="inventory-empty">Meldebestand wird aktualisiert …</div>'}</div></section>`:""}
    ${transferSection}
    <section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Bestellung → Wareneingang</span><h2>Bestellungen</h2><p>„Ware angekommen“ bucht nur die tatsächlich gelieferte Menge. Erst danach werden QR-Etiketten freigeschaltet.</p></div><button class="btn outline" type="button" data-inv="ordering-profile">Absenderdaten</button></div><div class="inventory-workspace-orders">${orders.length?orders.slice(0,40).map(inventoryWorkspaceOrderCard).join(""):'<div class="inventory-empty">Noch keine Bestellung.</div>'}</div></section>
    ${inventoryCatalogMasterSection(data)}
    <section class="inventory-workspace-panel"><div class="inventory-workspace-section-head"><div><span class="caps muted">Beschaffung</span><h2>Lieferanten</h2><p>Ein Lieferant kann beliebig viele Artikel enthalten. Foto, SKU, Preis, Verpackung und Mindestmenge werden pro Zuordnung gespeichert.</p></div><button class="btn" type="button" data-inv="suppliers">Lieferanten verwalten</button></div><div class="inventory-workspace-suppliers">${suppliers.length?suppliers.map(s=>inventoryCatalogSupplierCard(s,data)).join(""):'<div class="inventory-empty">Noch kein Lieferant hinterlegt.</div>'}</div></section>
  </div>`;
};

// Product creation keeps the existing hardened createItem/createPackUnit APIs and
// adds an optional private photo without making the product dependent on upload success.
inventoryProductModal=async function(){
  const data=S.inventoryWorkspaceCache[inventoryWorkspaceKey("orders")],categories=inventoryWorkspaceCategoryList(data?.stock?.items||[]),suppliers=data?.suppliers?.suppliers||[],listId=`inventory-category-${crypto.randomUUID().slice(0,8)}`;
  const d=modal(`${modalHeader("Bestellen","Neues Produkt")}<form class="form-grid inventory-product-create" id="inventory-product-create"><div class="field full inventory-photo-field"><label>Produktfoto</label><input class="input" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment"><small>Optional · JPG, PNG, WebP oder iPhone HEIC · max. 8 MB.</small></div><div class="field full"><label>Produktname</label><input class="input" name="name" maxlength="160" required placeholder="z. B. Oatly Barista"></div><div class="field"><label>Kategorie</label><input class="input" name="category" list="${listId}" maxlength="100" required placeholder="z. B. Milch & Alternativen"><datalist id="${listId}">${categories.map(c=>`<option value="${esc(c)}"></option>`).join("")}</datalist><small>Neue Eingabe = neue Kategorie.</small></div><div class="field"><label>SKU</label><input class="input" name="sku" maxlength="80" placeholder="optional · Aora erzeugt sonst eine"></div><div class="field"><label>Barcode</label><input class="input" name="barcode" maxlength="120" inputmode="numeric" placeholder="optional"></div><div class="field"><label>Basiseinheit</label><select class="select" name="baseUom"><option value="piece">Stück</option><option value="l">Liter</option><option value="ml">ml</option><option value="kg">kg</option><option value="g">g</option><option value="pack">Pack</option><option value="box">Box</option></select></div><div class="field"><label>Meldebestand</label><input class="input" name="reorderPoint" type="number" min="0" step="0.001" value="0"></div><div class="field"><label>Verpackung</label><input class="input" name="packLabel" maxlength="100" required value="Karton"></div><div class="field"><label>Inhalt pro Verpackung</label><input class="input" name="baseQuantity" type="number" min="0.001" step="0.001" required value="1"></div><div class="field full inventory-product-options"><label><input type="checkbox" name="orderUnit" checked> Diese Verpackung ist die Bestelleinheit</label><label><input type="checkbox" name="stockUnit" checked> Pro Verpackung später einen QR-Code erzeugen</label></div><div class="field full"><label>Lieferant zuordnen</label><select class="select" name="supplierId"><option value="">Später zuordnen</option>${suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div><div class="field"><label>Preis pro Verpackung</label><input class="input" name="unitPrice" type="number" min="0" step="0.01"></div><div class="field"><label>Minimum dieses Produkts</label><input class="input" name="minimumOrderQuantity" type="number" min="0.001" step="0.001" value="1"></div><div class="field"><label>Bestellschritt</label><input class="input" name="orderMultiple" type="number" min="0.001" step="0.001" value="1"></div><div class="field"><label>Lieferanten-SKU</label><input class="input" name="supplierSku" maxlength="120"></div><div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Produkt anlegen</button></div></form>`);
  const form=d.querySelector("#inventory-product-create");let createdItemId=null,createdPackId=null;
  form.addEventListener("submit",async event=>{event.preventDefault();if(!form.reportValidity())return;const f=new FormData(form),submit=form.querySelector('button[type="submit"]'),name=String(f.get("name")||"").trim(),sku=String(f.get("sku")||"").trim()||inventoryWorkspaceSku(),baseQuantity=Number(f.get("baseQuantity")),minimum=Number(f.get("minimumOrderQuantity")),multiple=Number(f.get("orderMultiple")),image=form.elements.image?.files?.[0]||null;if(!(baseQuantity>0))return toast("Inhalt pro Verpackung muss größer als 0 sein.","error");if(!(minimum>0)||!(multiple>0))return toast("Mindestmenge und Bestellschritt müssen größer als 0 sein.","error");submit.disabled=true;submit.textContent="Produkt wird angelegt …";try{if(!createdItemId){const item=await invRequest("createItem",{locationId:S.locationId,name,sku,barcode:f.get("barcode")||"",baseUom:f.get("baseUom")||"piece",category:f.get("category")||"",reorderPoint:Number(f.get("reorderPoint")||0)});createdItemId=item.itemId}if(!createdPackId){const packLabel=String(f.get("packLabel")||"Karton").trim(),code=(packLabel.replace(/[^A-Za-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,28)||"PACK")+"-"+crypto.randomUUID().slice(0,4).toUpperCase();const pack=await invRequest("createPackUnit",{locationId:S.locationId,itemId:createdItemId,code,label:packLabel,baseQuantity,isStockUnit:f.get("stockUnit")!==null,isOrderUnit:f.get("orderUnit")!==null});createdPackId=pack.id}const supplierId=String(f.get("supplierId")||"");if(supplierId)await invRequest("upsertSupplierItem",{locationId:S.locationId,supplierId,itemId:createdItemId,packUnitId:createdPackId,supplierSku:f.get("supplierSku")||"",supplierItemName:name,unitPrice:f.get("unitPrice")||null,currency:"EUR",minimumOrderQuantity:minimum,orderMultiple:multiple});let photoError=null;if(image){submit.textContent="Foto wird gespeichert …";try{await inventoryUploadCatalogPhoto("item",createdItemId,image)}catch(error){photoError=error}}d.remove();inventoryWorkspaceInvalidate();S.inventoryPageCache={};S.inventorySelectedCategory=String(f.get("category")||"").trim()||"Ohne Kategorie";toast(photoError?`Produkt gespeichert. Foto: ${photoError.message}`:"Produkt gespeichert.",photoError?"error":undefined);renderAdmin()}catch(error){toast(error.message,"error");submit.disabled=false;submit.textContent=createdItemId&&!createdPackId?"Verpackung erneut speichern":"Produkt anlegen"}});
};

// Supplier manager with photo management. Mapping itself opens the multi-item flow below.
supplierManagerModal=async function(){
  const d=modal(`${modalHeader("Bestellen","Lieferanten")}<div id="supplier-body"><div class="inventory-empty">Wird geladen …</div></div>`);
  async function load(){try{const r=await invRequest("listSupplierIntelligence",{locationId:S.locationId}),suppliers=r.suppliers||[],media=await inventoryMediaRequest("listInventoryMedia",{locationId:S.locationId,itemIds:[],supplierIds:suppliers.map(s=>s.id)}).catch(()=>({suppliers:[]})),mm=new Map((media.suppliers||[]).map(x=>[String(x.id),x.url]));d.querySelector("#supplier-body").innerHTML=`<div class="inventory-supplier-manage-list">${suppliers.map(s=>`<article class="inventory-supplier-manage-card">${inventoryCatalogPhoto(mm.get(String(s.id))||"",s.name,"supplier",s.id)}<div><strong>${esc(s.name)}</strong><small>${esc(s.contact?.email||"")} ${esc(s.contact?.whatsapp||"")}</small></div><div class="inventory-supplier-manage-actions"><button class="btn outline" type="button" data-inventory-photo-kind="supplier" data-inventory-photo-id="${s.id}">Foto</button><button class="btn" type="button" data-map-supplier="${s.id}">Produkte zuordnen</button></div></article>`).join("")||'<div class="inventory-empty">Noch kein Lieferant.</div>'}</div><form id="new-supplier" class="form-grid inventory-new-supplier"><div class="field full"><h3>Neuer Lieferant</h3></div><div class="field full"><label>Foto</label><input class="input" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment"></div><div class="field full"><label>Lieferant</label><input class="input" name="name" required></div><div class="field"><label>E-Mail</label><input class="input" name="email" type="email"></div><div class="field"><label>WhatsApp</label><input class="input" name="whatsapp" placeholder="+49 …"></div><div class="field full actions"><button class="btn" type="submit">Lieferant speichern</button></div></form>`;d.querySelector("#new-supplier").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form),button=form.querySelector('button[type="submit"]');button.disabled=true;try{const saved=await invRequest("upsertSupplier",{locationId:S.locationId,name:f.get("name"),email:f.get("email"),whatsapp:f.get("whatsapp"),orderingMethod:"BOTH"}),image=form.elements.image?.files?.[0]||null;if(image)await inventoryUploadCatalogPhoto("supplier",saved.id,image);toast("Lieferant gespeichert.");inventoryWorkspaceInvalidate();await load()}catch(err){toast(err.message,"error");button.disabled=false}})}catch(e){d.querySelector("#supplier-body").innerHTML=`<div class="inventory-empty">${esc(e.message)}</div>`}}
  d.addEventListener("click",e=>{const map=e.target.closest("[data-map-supplier]");if(map)mapSupplierItemModal(map.dataset.mapSupplier)});load();
};

function inventorySupplierGroup(items){const groups=new Map();for(const item of items){const c=inventoryCatalogCategory(item);if(!groups.has(c))groups.set(c,[]);groups.get(c).push(item)}return[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"de"))}
mapSupplierItemModal=async function(supplierId){
  const d=modal(`${modalHeader("Lieferant","Produkte zuordnen")}<div id="map-body"><div class="inventory-empty">Produkte werden geladen …</div></div>`);
  try{
    const[stock,mapped]=await Promise.all([invRequest("listStock",{locationId:S.locationId}),invRequest("listSupplierItems",{locationId:S.locationId,supplierId})]),items=stock.items||[],existingByItem=new Map((mapped.items||[]).map(x=>[String(x.item_id),x])),body=d.querySelector("#map-body");
    body.innerHTML=`<form id="supplier-multi-map" class="inventory-supplier-multi-map"><div class="inventory-smart-note"><strong>Mehrere Produkte auf einmal</strong><span>Wähle beliebig viele Artikel. Bereits zugeordnete Produkte können ebenfalls ausgewählt und bearbeitet werden.</span></div><div class="inventory-supplier-category-list">${inventorySupplierGroup(items).map(([category,rows])=>`<details class="inventory-supplier-category"><summary><span>${esc(category)}</span><small>${rows.length} Artikel</small></summary><div>${rows.map(item=>{const id=inventoryCatalogItemId(item),existing=existingByItem.get(id);return`<label class="inventory-supplier-check"><input type="checkbox" data-supplier-select="${esc(id)}"><span><strong>${esc(item.name)}</strong><small>${esc(item.sku||"")}${existing?" · ✓ bereits zugeordnet":""}</small></span></label>`}).join("")}</div></details>`).join("")||'<div class="inventory-empty">Noch keine Produkte vorhanden.</div>'}</div><div id="supplier-selected-editors" class="inventory-supplier-editors"><div class="inventory-empty">Wähle oben Produkte aus.</div></div><div class="inventory-sticky-actions"><span data-selected-count>0 Produkte ausgewählt</span><button class="btn" type="submit" disabled>Auswahl speichern</button></div></form>`;
    const form=body.querySelector("#supplier-multi-map"),editors=form.querySelector("#supplier-selected-editors"),submit=form.querySelector('button[type="submit"]'),count=form.querySelector("[data-selected-count]"),loaded=new Set();
    async function addEditor(itemId){if(loaded.has(itemId))return;loaded.add(itemId);const item=items.find(x=>inventoryCatalogItemId(x)===itemId),existing=existingByItem.get(itemId),wrap=document.createElement("article");wrap.className="inventory-supplier-editor";wrap.dataset.itemEditor=itemId;wrap.innerHTML=`<div><strong>${esc(item?.name||"Artikel")}</strong><small>Bestelleinheiten werden geladen …</small></div>`;editors.appendChild(wrap);try{const r=await invRequest("listPackUnits",{locationId:S.locationId,itemId}),packs=r.packUnits||[];wrap.innerHTML=`<div class="inventory-supplier-editor-title"><strong>${esc(item?.name||"Artikel")}</strong>${existing?'<span>✓ Zugeordnet</span>':""}</div><div class="form-grid"><div class="field full"><label>Bestelleinheit</label><select class="select" name="packUnitId" required>${packs.map(p=>`<option value="${p.id}" ${String(p.id)===String(existing?.pack_unit_id)||(!existing&&p.is_order_unit)?"selected":""}>${esc(p.label)} · ${invNumber(p.baseQuantity)} Basiseinheiten</option>`).join("")}</select>${packs.length?"":'<small class="inventory-error">Keine Verpackung vorhanden.</small>'}</div><div class="field"><label>Lieferanten-SKU</label><input class="input" name="supplierSku" value="${esc(existing?.supplier_sku||"")}"></div><div class="field"><label>Name beim Lieferanten</label><input class="input" name="supplierItemName" value="${esc(existing?.supplier_item_name||item?.name||"")}"></div><div class="field"><label>Preis / Bestelleinheit</label><input class="input" name="unitPrice" type="number" min="0" step="0.01" value="${existing?.unit_price??""}"></div><div class="field"><label>Währung</label><input class="input" name="currency" maxlength="3" value="${esc(existing?.currency||"EUR")}"></div><div class="field"><label>Mindestbestellmenge</label><input class="input" name="minimumOrderQuantity" type="number" min="0.001" step="0.001" value="${existing?.minimum_order_quantity??1}"></div><div class="field"><label>Bestellschritt</label><input class="input" name="orderMultiple" type="number" min="0.001" step="0.001" value="${existing?.order_multiple??1}"></div></div>`}catch(error){wrap.innerHTML=`<div class="inventory-warning"><strong>${esc(item?.name||"Artikel")}</strong><small>${esc(error.message)}</small></div>`}}
    function removeEditor(itemId){loaded.delete(itemId);editors.querySelector(`[data-item-editor="${CSS.escape(itemId)}"]`)?.remove()}
    async function sync(){const checked=[...form.querySelectorAll("[data-supplier-select]:checked")].map(x=>x.dataset.supplierSelect);if(!checked.length){editors.innerHTML='<div class="inventory-empty">Wähle oben Produkte aus.</div>';loaded.clear()}else{if(editors.querySelector(".inventory-empty"))editors.innerHTML="";for(const id of [...loaded])if(!checked.includes(id))removeEditor(id);for(const id of checked)await addEditor(id)}count.textContent=`${checked.length} Produkt${checked.length===1?"":"e"} ausgewählt`;submit.disabled=!checked.length}
    form.addEventListener("change",e=>{if(e.target.matches("[data-supplier-select]"))sync()});
    form.addEventListener("submit",async e=>{e.preventDefault();const selected=[...form.querySelectorAll("[data-supplier-select]:checked")].map(x=>x.dataset.supplierSelect);if(!selected.length)return;submit.disabled=true;submit.textContent="Wird gespeichert …";let saved=0;try{for(const itemId of selected){const editor=editors.querySelector(`[data-item-editor="${CSS.escape(itemId)}"]`),existing=existingByItem.get(itemId);if(!editor)throw new Error("Produktdetails fehlen.");const f=new FormData();for(const field of editor.querySelectorAll("[name]"))f.set(field.name,field.value);const packUnitId=f.get("packUnitId");if(!packUnitId)throw new Error("Für jedes Produkt muss eine Bestelleinheit existieren.");await invRequest("upsertSupplierItem",{locationId:S.locationId,supplierId,supplierItemId:existing?.id||null,itemId,packUnitId,supplierSku:f.get("supplierSku"),supplierItemName:f.get("supplierItemName"),unitPrice:f.get("unitPrice")||null,currency:f.get("currency")||"EUR",minimumOrderQuantity:Number(f.get("minimumOrderQuantity")||1),orderMultiple:Number(f.get("orderMultiple")||1)});saved++}d.remove();inventoryWorkspaceInvalidate();S.inventoryPageCache={};toast(`${saved} Produkt${saved===1?"":"e"} dem Lieferanten zugeordnet.`);renderAdmin()}catch(error){toast(`${saved} gespeichert. ${error.message}`,"error");submit.disabled=false;submit.textContent="Auswahl speichern"}});
  }catch(error){d.querySelector("#map-body").innerHTML=`<div class="inventory-empty">${esc(error.message)}</div>`}
};

app.addEventListener("click",event=>{
  const category=event.target.closest?.("[data-inventory-category]");if(category){S.inventorySelectedCategory=category.dataset.inventoryCategory;renderAdmin();return}
  if(event.target.closest?.("[data-inventory-category-back]")){S.inventorySelectedCategory=null;renderAdmin();return}
  const photo=event.target.closest?.("[data-inventory-photo-kind][data-inventory-photo-id]");if(photo){event.preventDefault();event.stopPropagation();inventoryChooseCatalogPhoto(photo.dataset.inventoryPhotoKind,photo.dataset.inventoryPhotoId);return}
  const danger=event.target.closest?.("[data-inventory-danger-order]");if(danger){S.inventoryOrderFocus={itemId:danger.dataset.inventoryDangerOrder,suggestedBaseQuantity:Number(danger.dataset.inventoryDangerQty||0)};newOrderModal();return}
},true);
