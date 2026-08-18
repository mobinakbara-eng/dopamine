"use strict";

function canManageInventoryQr(){
  const a=invAvailability();
  return ["owner","manager"].includes(S.accessRole)&&Boolean(a?.enabled&&a?.features?.inventoryQr&&a?.features?.inventoryPrinting&&a?.permissions?.receipt);
}

const _inventoryStockQrManager=inventoryStock;
inventoryStock=function(d){
  const html=_inventoryStockQrManager(d);
  if(!canManageInventoryQr())return html;
  return html.replace(
    '<button class="btn outline" data-inv="employee-access">Scan-Zugriff</button>',
    '<button class="btn" data-inv="qr-labels">QR & Etiketten</button><button class="btn outline" data-inv="employee-access">Scan-Zugriff</button>'
  );
};

const _inventoryReceivingQrManager=inventoryReceiving;
inventoryReceiving=function(d){
  const html=_inventoryReceivingQrManager(d);
  if(!canManageInventoryQr())return html;
  return html.replace(
    '<div class="inventory-card-head"><h2>Wareneingang</h2></div>',
    '<div class="inventory-card-head"><h2>Wareneingang</h2><button class="btn" data-inv="qr-labels">QR & Etiketten</button></div>'
  );
};

function qrPackOptions(packs){
  const stock=(packs||[]).filter(p=>p.is_stock_unit);
  if(!stock.length)return '<option value="">Keine QR-fähige Verpackung</option>';
  return stock.map(p=>`<option value="${p.id}">${esc(p.label||p.code||"Verpackung")} · ${Number(p.baseQuantity||p.base_quantity||0)}</option>`).join("");
}

function printQrBatch(batch,itemName){
  const labels=batch?.labels||[];
  if(!labels.length)return toast("Keine QR-Etiketten vorhanden.","error");
  const profile=batch.profile||{};
  const width=Number(profile.labelWidthMm||profile.label_width_mm||50)||50;
  const height=Number(profile.labelHeightMm||profile.label_height_mm||30)||30;
  const popup=window.open("","_blank");
  if(!popup)return toast("Pop-up wurde blockiert. Bitte Pop-ups für Aora erlauben.","error");
  const cards=labels.map(label=>`<section class="label"><div class="name">${esc(itemName||"Aora Bestand")}</div><div class="qr">${label.svg||""}</div><div class="code">${esc(label.shortCode||"")}</div></section>`).join("");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Aora QR Etiketten</title><style>@page{margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.label{width:${width}mm;height:${height}mm;page-break-after:always;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:1.5mm}.label:last-child{page-break-after:auto}.name{font-size:8pt;font-weight:700;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qr svg{width:20mm;height:20mm;display:block}.code{font-size:7pt;letter-spacing:.5px;font-weight:700}</style></head><body>${cards}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));<\/script></body></html>`);
  popup.document.close();
}

async function showPreparedQrBatch(dialog,prepared,itemName){
  dialog._aoraQrBatch=prepared;
  dialog._aoraQrItemName=itemName;
  const body=dialog.querySelector("#qr-manager-body");
  body.innerHTML=`<div class="inventory-scan-status"><strong>${prepared.labels?.length||0} QR-Etiketten bereit.</strong><p>Jetzt drucken. Erst danach als gedruckt bestätigen. Wenn du QR neu erzeugst, werden unbestätigte alte Codes ungültig.</p></div><div class="inventory-actions" style="margin:14px 0"><button class="btn" type="button" data-qr-action="print">Drucken / PDF</button><button class="btn outline" type="button" data-qr-action="confirm" data-job-id="${prepared.printJobId}">Als gedruckt bestätigen</button></div><div class="inventory-qr-preview">${(prepared.labels||[]).slice(0,12).map(l=>`<div class="inventory-card" style="padding:10px;text-align:center">${l.svg||""}<small>${esc(l.shortCode||"")}</small></div>`).join("")}</div>${(prepared.labels||[]).length>12?`<p class="muted">+ ${(prepared.labels||[]).length-12} weitere Etiketten</p>`:""}`;
}

async function prepareExistingPrintJob(dialog,job){
  if(job.status==="prepared"){
    const ok=window.confirm("Für diesen Auftrag wurden bereits QR-Codes vorbereitet. Neu erzeugen macht die vorherigen unbestätigten Codes ungültig. Fortfahren?");
    if(!ok)return;
  }
  try{
    const prepared=await invRequest("preparePrintJob",{locationId:S.locationId,printJobId:job.id});
    await showPreparedQrBatch(dialog,prepared,job.item?.name||"Aora Bestand");
  }catch(error){toast(error.message,"error")}
}

async function qrManagerModal(){
  if(!canManageInventoryQr())return toast("QR-Erstellung ist für diesen Manager oder Standort nicht freigeschaltet.","error");
  const dialog=modal(`${modalHeader("Bestand","QR & Etiketten")}<div id="qr-manager-body"><div class="inventory-empty">Wird geladen …</div></div>`);
  const body=dialog.querySelector("#qr-manager-body");
  try{
    const [stock,jobs,profile]=await Promise.all([
      invRequest("listStock",{locationId:S.locationId}),
      invRequest("listPrintJobs",{locationId:S.locationId}),
      invRequest("getPrintProfile",{locationId:S.locationId})
    ]);
    dialog._aoraQrProfile=profile;
    const items=stock.items||[];
    const openJobs=jobs.jobs||[];
    body.innerHTML=`<div class="inventory-scan-status"><strong>Neue Ware mit QR erfassen</strong><p>Diese Funktion bucht die ausgewählte Menge als Wareneingang und erzeugt danach pro Verpackung einen eindeutigen QR-Code. Für bereits vorhandenen Bestand wird keine zusätzliche Menge automatisch erfunden.</p></div><form id="qr-create-form" class="form-grid" style="margin-top:14px"><div class="field full"><label>Artikel</label><select class="select" name="itemId">${items.map(i=>`<option value="${i.itemId}">${esc(i.name)} · ${esc(i.sku||"")}</option>`).join("")}</select></div><div class="field full" id="qr-pack-field"><div class="inventory-empty">Verpackungen werden geladen …</div></div><div class="field"><label>Anzahl Etiketten / Verpackungen</label><input class="input" name="count" type="number" min="1" max="100" step="1" value="1" required></div><div class="field full actions"><button class="btn" type="submit">Wareneingang + QR erzeugen</button></div></form><div style="margin-top:22px"><div class="inventory-card-head"><h3>Offene Druckaufträge</h3></div>${openJobs.length?openJobs.map(j=>`<div class="inventory-order-row"><div><strong>${esc(j.item?.name||"Artikel")}</strong><small>${Number(j.labelCount||0)} Etiketten · ${j.status==="prepared"?"vorbereitet":"offen"}</small></div><span></span><span></span><button class="btn outline" type="button" data-qr-job="${j.id}">${j.status==="prepared"?"QR neu öffnen":"QR erzeugen"}</button></div>`).join(""):'<div class="inventory-empty">Keine offenen Druckaufträge.</div>'}</div>`;

    const form=body.querySelector("#qr-create-form");
    const packField=body.querySelector("#qr-pack-field");
    async function loadPacks(){
      packField.innerHTML='<div class="inventory-empty">Verpackungen werden geladen …</div>';
      try{
        const packs=await invRequest("listPackUnits",{locationId:S.locationId,itemId:form.itemId.value});
        packField.innerHTML=`<label>QR-Verpackung</label><select class="select" name="packUnitId">${qrPackOptions(packs.packUnits)}</select><small>Nur als Stock Unit markierte Verpackungen können einen verbrauchbaren QR erhalten.</small>`;
      }catch(error){packField.innerHTML=`<div class="inventory-empty">${esc(error.message)}</div>`}
    }
    form.itemId.addEventListener("change",loadPacks);
    await loadPacks();
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      const pack=form.querySelector('[name="packUnitId"]');
      if(!pack?.value)return toast("Für diesen Artikel ist noch keine QR-fähige Verpackung eingerichtet.","error");
      button.disabled=true;
      button.textContent="QR wird erzeugt …";
      try{
        const item=items.find(i=>String(i.itemId)===String(form.itemId.value));
        const receipt=await invRequest("receiveQrUnits",{locationId:S.locationId,itemId:form.itemId.value,packUnitId:pack.value,count:Number(form.count.value),idempotencyKey:crypto.randomUUID()});
        const prepared=await invRequest("preparePrintJob",{locationId:S.locationId,printJobId:receipt.printJobId});
        S.inventoryPageCache={};
        await showPreparedQrBatch(dialog,{...prepared,profile:dialog._aoraQrProfile},item?.name||"Aora Bestand");
        toast("QR-Etiketten wurden erzeugt.");
      }catch(error){toast(error.message,"error");button.disabled=false;button.textContent="Wareneingang + QR erzeugen"}
    });

    dialog.addEventListener("click",event=>{
      const button=event.target.closest("[data-qr-job]");
      if(!button)return;
      const job=openJobs.find(j=>String(j.id)===String(button.dataset.qrJob));
      if(job)prepareExistingPrintJob(dialog,job);
    });
  }catch(error){body.innerHTML=`<div class="inventory-empty">${esc(error.message)}</div>`}

  dialog.addEventListener("click",async event=>{
    const action=event.target.closest("[data-qr-action]");
    if(!action)return;
    if(action.dataset.qrAction==="print"){
      printQrBatch({...dialog._aoraQrBatch,profile:dialog._aoraQrProfile},dialog._aoraQrItemName);
      return;
    }
    if(action.dataset.qrAction==="confirm"){
      action.disabled=true;
      try{
        await invRequest("confirmPrintJob",{locationId:S.locationId,printJobId:action.dataset.jobId});
        S.inventoryPageCache={};
        toast("Druckauftrag bestätigt. QR-Codes sind aktiv.");
        dialog.remove();
        renderAdmin();
      }catch(error){toast(error.message,"error");action.disabled=false}
    }
  });
}

app.addEventListener("click",event=>{
  const button=event.target.closest("[data-inv]");
  if(button?.dataset.inv==="qr-labels")qrManagerModal();
});
