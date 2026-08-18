"use strict";

function supplierRuleNumber(value,fallback=1){const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback}
function suggestedPackCount(x,focusedBaseQuantity=0){
  const packBase=supplierRuleNumber(x.pack?.base_quantity??x.pack?.baseQuantity,1),minimum=supplierRuleNumber(x.minimum_order_quantity,1),multiple=supplierRuleNumber(x.order_multiple,1);
  const baseNeed=Math.max(Number(x.suggestedBaseQuantity||0),Number(focusedBaseQuantity||0));
  if(!Number.isFinite(baseNeed)||baseNeed<=0)return 0;
  const raw=baseNeed/packBase,rounded=Math.ceil((Math.max(raw,minimum)/multiple)-1e-10)*multiple;
  return Math.round(rounded*1e6)/1e6;
}
function orderMoney(value,currency="EUR"){const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat("de-DE",{style:"currency",currency:String(currency||"EUR").toUpperCase()}).format(n):"–"}

async function newOrderModal(){
  const focus=S.inventoryOrderFocus||null,d=modal(`${modalHeader("Bestand",focus?"Aora Bestellung vorbereiten":"Neue Bestellung")}<div id="inv-order-body"><div class="inventory-empty">Lieferanten werden geladen …</div></div>`);
  try{
    const r=await invRequest("listSuppliers",{locationId:S.locationId}),b=d.querySelector("#inv-order-body");
    b.innerHTML=`${focus?'<div class="inventory-smart-note"><strong>Aora Vorschlag</strong><span>Wähle den Lieferanten. Die benötigte Menge wird passend zu Verpackung, Mindestmenge und Bestellschritt gerundet.</span></div>':""}<div class="inventory-supplier-grid">${(r.suppliers||[]).map(s=>`<button class="inventory-supplier" type="button" data-supplier-pick="${s.id}"><strong>${esc(s.name)}</strong><small>${s.contact?.email?"E-Mail":""}${s.contact?.email&&s.contact?.whatsapp?" + ":""}${s.contact?.whatsapp?"WhatsApp":""}</small></button>`).join("")||'<div class="inventory-empty">Bitte zuerst einen Lieferanten anlegen.</div>'}</div>`;
    b.addEventListener("click",e=>{const x=e.target.closest("[data-supplier-pick]");if(x)renderSupplierOrderForm(d,x.dataset.supplierPick)});
  }catch(e){d.querySelector("#inv-order-body").innerHTML=`<div class="inventory-empty">${esc(e.message)}</div>`}
}

async function renderSupplierOrderForm(d,supplierId){
  const b=d.querySelector("#inv-order-body"),focus=S.inventoryOrderFocus||null;
  b.innerHTML='<div class="inventory-empty">Artikel werden geladen …</div>';
  try{
    const r=await invRequest("listSupplierItems",{locationId:S.locationId,supplierId}),items=r.items||[],focusMatch=focus?items.find(x=>String(x.item_id)===String(focus.itemId)):null;
    b.innerHTML=`<form class="form-grid inventory-smart-order-form">
      ${focus&&!focusMatch?'<div class="field full inventory-warning"><strong>Dieser Lieferant ist für den vorgeschlagenen Artikel noch nicht hinterlegt.</strong><small>Wähle einen anderen Lieferanten oder ordne den Artikel zuerst unter „Lieferanten“ zu.</small></div>':""}
      <div class="field full"><label>Artikel</label><div class="inventory-order-items">${items.map(x=>{
        const isFocus=focus&&String(x.item_id)===String(focus.itemId),suggested=suggestedPackCount(x,isFocus?focus.suggestedBaseQuantity:0),packLabel=x.pack?.label||x.item?.base_uom||"Einheit",minimum=supplierRuleNumber(x.minimum_order_quantity,1),multiple=supplierRuleNumber(x.order_multiple,1),price=x.unit_price==null?"":orderMoney(x.unit_price,x.currency);
        return`<div class="inventory-order-item ${isFocus?"focus":""}" data-order-line="${x.id}">
          <div><strong>${esc(x.supplier_item_name||x.item?.name||"Artikel")}</strong><small>Bestand ${invNumber(x.onHand)}${x.item?.base_uom?` ${esc(x.item.base_uom)}`:""} · PAR ${x.parLevel??"–"} · ${esc(packLabel)}${price?` · ${esc(price)}`:""}</small><small>${suggested>0?`Aora empfiehlt ${invNumber(suggested)} ${esc(packLabel)} · `:""}Minimum ${invNumber(minimum)} · Schritt ${invNumber(multiple)}</small></div>
          <div class="inventory-order-qty"><input class="input" type="number" min="0" step="any" value="${suggested||0}" data-supplier-item="${x.id}" data-minimum="${minimum}" data-multiple="${multiple}" data-price="${x.unit_price??""}" data-currency="${esc(x.currency||"EUR")}"><span>${esc(packLabel)}</span></div>
        </div>`;
      }).join("")||'<div class="inventory-empty">Für diesen Lieferanten sind noch keine Artikel zugeordnet.</div>'}</div></div>
      <div class="field full inventory-order-summary" data-order-summary></div>
      <div class="field"><label>Gewünschte Lieferung</label><input class="input" type="date" name="expectedOn"></div>
      <div class="field"><label>Notiz</label><input class="input" name="note" maxlength="500"></div>
      <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit" ${items.length?"":"disabled"}>Bestellung als Entwurf anlegen</button></div>
    </form>`;

    const form=b.querySelector("form"),inputs=[...form.querySelectorAll("[data-supplier-item]")],summary=form.querySelector("[data-order-summary]");
    const updateSummary=()=>{
      const selected=inputs.filter(i=>Number(i.value)>0),currencies=new Set(selected.map(i=>i.dataset.currency||"EUR")),total=selected.reduce((sum,i)=>sum+Number(i.value)*Number(i.dataset.price||0),0);
      summary.innerHTML=selected.length?`<strong>${selected.length} Position${selected.length===1?"":"en"}</strong><span>${currencies.size===1?`Geschätzter Warenwert ${orderMoney(total,[...currencies][0])}`:"Mehrere Währungen"}</span>`:'<span>Noch keine Position ausgewählt.</span>';
    };
    inputs.forEach(i=>i.addEventListener("input",updateSummary));
    updateSummary();
    if(focusMatch)queueMicrotask(()=>form.querySelector(`[data-order-line="${focusMatch.id}"]`)?.scrollIntoView({block:"center"}));

    form?.addEventListener("submit",async e=>{
      e.preventDefault();
      const lines=[];
      for(const input of inputs){
        const packCount=Number(input.value);
        if(!(packCount>0))continue;
        const minimum=Number(input.dataset.minimum||1),multiple=Number(input.dataset.multiple||1);
        if(packCount<minimum||Math.abs(packCount/multiple-Math.round(packCount/multiple))>1e-8){
          input.focus();
          return toast(`Menge muss mindestens ${invNumber(minimum)} und ein Vielfaches von ${invNumber(multiple)} sein.`,"error");
        }
        lines.push({supplierItemId:input.dataset.supplierItem,packCount});
      }
      if(!lines.length)return toast("Bitte mindestens einen Artikel auswählen.","error");
      const f=new FormData(e.currentTarget),submit=e.currentTarget.querySelector('button[type="submit"]');
      submit.disabled=true;
      try{
        await invRequest("createPurchaseOrder",{locationId:S.locationId,supplierId,lines,expectedOn:f.get("expectedOn")||null,note:f.get("note")||"",idempotencyKey:crypto.randomUUID()});
        S.inventoryOrderFocus=null;
        d.remove();
        S.inventoryPageCache={};
        toast("Bestellung als Entwurf angelegt.");
        renderAdmin();
      }catch(err){toast(err.message,"error");submit.disabled=false}
    });
  }catch(e){b.innerHTML=`<div class="inventory-empty">${esc(e.message)}</div>`}
}

async function sendOrderModal(orderId){
  const data=S.inventoryPageCache[`${invKey()}:orders`],order=data?.orders?.orders?.find(x=>x.id===orderId);
  if(!order)return toast("Bestellung bitte aktualisieren.","error");
  const c=order.supplier?.contact||{},d=modal(`${modalHeader("Bestellung","Versand auswählen")}<div class="form-grid"><div class="field full"><strong>${esc(order.supplier?.name||"Lieferant")}</strong><p>Bestellung mit den hinterlegten Daten des aktuellen Ladens senden. Wiederholtes Tippen sendet nicht doppelt.</p></div><div class="field full actions">${c.email?'<button class="btn" type="button" data-send-channel="email">Per E-Mail senden</button>':""}${c.whatsapp?'<button class="btn outline" type="button" data-send-channel="whatsapp">Per WhatsApp senden</button>':""}</div><div class="field full" id="send-result"></div></div>`);
  d.addEventListener("click",async e=>{
    const b=e.target.closest("[data-send-channel]");
    if(!b)return;
    b.disabled=true;
    try{
      const r=await invRequest("sendPurchaseOrder",{purchaseOrderId:orderId,channel:b.dataset.sendChannel});
      if(r.manualLink){
        window.open(r.manualLink,"_blank","noopener");
        const ds=await invRequest("listPurchaseOrderDeliveries",{purchaseOrderId:orderId}),delivery=(ds.deliveries||[]).find(x=>x.status==="manual_required");
        d.querySelector("#send-result").innerHTML=`<div class="inventory-scan-status"><strong>Nachricht vorbereitet.</strong><p>Nach dem Senden zurück zu Aora wechseln und bestätigen.</p>${delivery?`<button class="btn" data-confirm-manual="${delivery.id}" type="button">Als gesendet markieren</button>`:""}</div>`;
      }else{
        d.remove();S.inventoryPageCache={};toast(r.idempotent?"Bestellung war bereits gesendet.":"Bestellung wurde gesendet.");renderAdmin();
      }
    }catch(err){toast(err.message,"error");b.disabled=false}
  });
  d.addEventListener("click",async e=>{
    const b=e.target.closest("[data-confirm-manual]");
    if(!b)return;
    b.disabled=true;
    try{await invRequest("confirmManualPurchaseOrderSent",{purchaseOrderId:orderId,deliveryId:b.dataset.confirmManual});d.remove();S.inventoryPageCache={};toast("Bestellung als gesendet markiert.");renderAdmin()}
    catch(err){toast(err.message,"error");b.disabled=false}
  });
}

async function supplierManagerModal(){
  const d=modal(`${modalHeader("Bestellen","Lieferanten")}<div id="supplier-body"><div class="inventory-empty">Wird geladen …</div></div>`);
  async function load(){
    try{
      const r=await invRequest("listSuppliers",{locationId:S.locationId});
      d.querySelector("#supplier-body").innerHTML=`<div class="inventory-list">${(r.suppliers||[]).map(s=>`<div class="inventory-row"><div><strong>${esc(s.name)}</strong><small>${esc(s.contact?.email||"")} ${esc(s.contact?.whatsapp||"")}</small></div><span></span><span></span><span></span><button class="btn outline" data-map-supplier="${s.id}">Artikel</button></div>`).join("")}</div><form id="new-supplier" class="form-grid" style="padding:16px"><div class="field full"><label>Lieferant</label><input class="input" name="name" required></div><div class="field"><label>E-Mail</label><input class="input" name="email" type="email"></div><div class="field"><label>WhatsApp</label><input class="input" name="whatsapp" placeholder="+49 …"></div><div class="field full actions"><button class="btn" type="submit">Lieferant speichern</button></div></form>`;
      d.querySelector("#new-supplier").addEventListener("submit",async e=>{
        e.preventDefault();const f=new FormData(e.currentTarget);
        try{await invRequest("upsertSupplier",{locationId:S.locationId,name:f.get("name"),email:f.get("email"),whatsapp:f.get("whatsapp"),orderingMethod:"BOTH"});toast("Lieferant gespeichert.");load()}
        catch(err){toast(err.message,"error")}
      });
    }catch(e){d.querySelector("#supplier-body").innerHTML=`<div class="inventory-empty">${esc(e.message)}</div>`}
  }
  d.addEventListener("click",e=>{const b=e.target.closest("[data-map-supplier]");if(b)mapSupplierItemModal(b.dataset.mapSupplier)});
  load();
}

async function mapSupplierItemModal(supplierId){
  const d=modal(`${modalHeader("Lieferant","Artikel zuordnen")}<div id="map-body"><div class="inventory-empty">Artikel werden geladen …</div></div>`);
  try{
    const stock=await invRequest("listStock",{locationId:S.locationId}),body=d.querySelector("#map-body");
    body.innerHTML=`<form class="form-grid">
      <div class="field full"><label>Aora Artikel</label><select class="select" name="itemId">${(stock.items||[]).map(i=>`<option value="${i.itemId}">${esc(i.name)} · ${esc(i.sku||"")}</option>`).join("")}</select></div>
      <div class="field full" data-pack-field><label>Bestelleinheit</label><div class="inventory-empty">Verpackungen werden geladen …</div></div>
      <div class="field"><label>Lieferanten-SKU</label><input class="input" name="supplierSku"></div>
      <div class="field"><label>Lieferantenname</label><input class="input" name="supplierItemName"></div>
      <div class="field"><label>Preis pro Bestelleinheit</label><input class="input" name="unitPrice" type="number" step="0.01" min="0"></div>
      <div class="field"><label>Währung</label><input class="input" name="currency" value="EUR" maxlength="3" pattern="[A-Za-z]{3}"></div>
      <div class="field"><label>Mindestbestellmenge</label><input class="input" name="minimumOrderQuantity" type="number" min="0.001" step="0.001" value="1"></div>
      <div class="field"><label>Bestellschritt</label><input class="input" name="orderMultiple" type="number" min="0.001" step="0.001" value="1"></div>
      <div class="field full inventory-smart-note"><strong>Warum diese Felder?</strong><span>Aora rundet spätere Bestellvorschläge automatisch auf die echte Lieferanten-Verpackung, Mindestmenge und Bestellschritte.</span></div>
      <div class="field full actions"><button class="btn" type="submit">Zuordnen</button></div>
    </form>`;
    const form=body.querySelector("form"),packField=form.querySelector("[data-pack-field]");
    async function loadPacks(){
      packField.innerHTML='<label>Bestelleinheit</label><div class="inventory-empty">Verpackungen werden geladen …</div>';
      try{
        const packs=await invRequest("listPackUnits",{locationId:S.locationId,itemId:form.itemId.value}),all=packs.packUnits||[];
        if(!all.length){packField.innerHTML='<label>Bestelleinheit</label><div class="inventory-warning"><strong>Keine Verpackung angelegt.</strong><small>Lege zuerst eine Verpackung für diesen Artikel an.</small></div>';return}
        packField.innerHTML=`<label>Bestelleinheit</label><select class="select" name="packUnitId" required>${all.map(p=>`<option value="${p.id}" ${p.is_order_unit?"selected":""}>${esc(p.label)} · ${invNumber(p.baseQuantity)} Basiseinheiten${p.is_order_unit?" · Standard":""}</option>`).join("")}</select>`;
      }catch(err){packField.innerHTML=`<label>Bestelleinheit</label><div class="inventory-warning"><strong>Verpackungen konnten nicht geladen werden.</strong><small>${esc(err.message)}</small></div>`}
    }
    form.itemId.addEventListener("change",loadPacks);await loadPacks();
    form.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(e.currentTarget),packUnitId=f.get("packUnitId");
      if(!packUnitId)return toast("Bitte zuerst eine Bestelleinheit anlegen oder auswählen.","error");
      try{
        await invRequest("upsertSupplierItem",{locationId:S.locationId,supplierId,itemId:f.get("itemId"),packUnitId,supplierSku:f.get("supplierSku"),supplierItemName:f.get("supplierItemName"),unitPrice:f.get("unitPrice")||null,currency:f.get("currency")||"EUR",minimumOrderQuantity:Number(f.get("minimumOrderQuantity")),orderMultiple:Number(f.get("orderMultiple"))});
        d.remove();toast("Artikel wurde mit Bestellregeln zugeordnet.");
      }catch(err){toast(err.message,"error")}
    });
  }catch(e){d.querySelector("#map-body").innerHTML=`<div class="inventory-empty">${esc(e.message)}</div>`}
}

async function receiveOrderModal(orderId){
  const order=(S.inventoryPageCache[`${invKey()}:receiving`]?.orders?.orders||[]).find(o=>o.id===orderId);
  if(!order)return toast("Bestellung bitte aktualisieren.","error");
  const open=(order.lines||[]).filter(l=>Number(l.receivedQuantity)<Number(l.orderedQuantity)),d=modal(`${modalHeader("Wareneingang",esc(order.supplier?.name||"Lieferung"))}<form class="form-grid" id="receive-form"><div class="field full"><label>Artikel</label><select class="select" name="itemId">${open.map(l=>`<option value="${l.item_id}">${esc(l.item?.name||"Artikel")} · offen ${Number(l.orderedQuantity)-Number(l.receivedQuantity)}</option>`).join("")}</select></div><div class="field full" id="pack-field"><div class="inventory-empty">Verpackung wird geladen …</div></div><div class="field"><label>Anzahl</label><input class="input" name="packCount" type="number" min="1" value="1"></div><div class="field full actions"><button class="btn" type="submit">Wareneingang buchen</button></div></form>`),form=d.querySelector("form"),pf=d.querySelector("#pack-field");
  async function packs(){
    try{const r=await invRequest("listPackUnits",{locationId:S.locationId,itemId:form.itemId.value});pf.innerHTML=`<label>Verpackung</label><select class="select" name="packUnitId">${(r.packUnits||[]).map(p=>`<option value="${p.id}" data-stock-unit="${p.is_stock_unit?1:0}">${esc(p.label)} · ${p.baseQuantity}</option>`).join("")}</select>`}
    catch(e){pf.innerHTML=`<div class="inventory-empty">${esc(e.message)}</div>`}
  }
  form.itemId.addEventListener("change",packs);await packs();
  form.addEventListener("submit",async e=>{
    e.preventDefault();const p=form.querySelector('[name="packUnitId"]'),option=p?.selectedOptions?.[0],count=Number(form.packCount.value);
    try{
      if(option?.dataset.stockUnit==="1")await invRequest("receiveQrUnits",{locationId:S.locationId,purchaseOrderId:orderId,itemId:form.itemId.value,packUnitId:p.value,count,idempotencyKey:crypto.randomUUID()});
      else await invRequest("receivePurchaseOrderLine",{locationId:S.locationId,purchaseOrderId:orderId,itemId:form.itemId.value,packUnitId:p.value,packCount:count,idempotencyKey:crypto.randomUUID()});
      d.remove();S.inventoryPageCache={};toast("Wareneingang gebucht.");renderAdmin();
    }catch(err){toast(err.message,"error")}
  });
}

app.addEventListener("click",e=>{
  const b=e.target.closest("[data-inv]");
  if(!b)return;
  if(b.dataset.inv==="new-order")newOrderModal();
  else if(b.dataset.inv==="send-order")sendOrderModal(b.dataset.id);
  else if(b.dataset.inv==="suppliers")supplierManagerModal();
  else if(b.dataset.inv==="receive-order")receiveOrderModal(b.dataset.id);
});
