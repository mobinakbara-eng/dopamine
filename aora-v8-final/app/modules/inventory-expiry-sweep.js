"use strict";

async function runInventoryExpiryPool(items,limit,worker){
  let cursor=0;
  const runners=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(cursor<items.length){const current=items[cursor++];await worker(current)}
  });
  await Promise.all(runners);
}

function inventoryExpiredTrace(unit){
  return [unit.shortCode?`QR ${unit.shortCode}`:"",unit.lotCode?`Charge ${unit.lotCode}`:"",unit.expiresOn?`MHD ${invDate(unit.expiresOn)}`:""].filter(Boolean).join(" · ");
}

async function openExpiredStockReview(){
  const d=modal(`${modalHeader("Bestand","Abgelaufene QR-Einheiten prüfen")}<div id="expired-stock-body"><div class="inventory-empty">Aora prüft die abgelaufenen Einheiten …</div></div>`);
  try{
    const r=await invRequest("listExpiredStockUnits",{locationId:S.locationId}),units=r.units||[],body=d.querySelector("#expired-stock-body");
    if(!units.length){body.innerHTML='<div class="inventory-empty"><strong>Keine abgelaufenen QR-Einheiten.</strong><br>Der Bestand wurde bereits bereinigt oder aktualisiert.</div>';return}
    const total=units.reduce((sum,u)=>sum+Number(u.remainingQuantity||0),0);
    body.innerHTML=`<form class="inventory-expired-review-form">
      <div class="inventory-warning inventory-expired-warning"><strong>Nichts wird automatisch ausgebucht.</strong><small>Alle unten stehenden Einheiten sind laut gespeicherten MHD bereits abgelaufen. Prüfe sie physisch und entferne die Auswahl bei einer Einheit, die nicht ausgebucht werden soll.</small></div>
      <div class="inventory-expired-summary"><div><span class="caps muted">Abgelaufen</span><strong>${units.length} QR-Einheit${units.length===1?"":"en"}</strong></div><div><span>Gespeicherte Restmenge</span><strong>${invNumber(total)}</strong></div></div>
      <div class="inventory-expired-list">${units.map(u=>`<label class="inventory-expired-row" data-expired-row="${u.id}">
        <input type="checkbox" name="stockUnitId" value="${u.id}" checked>
        <span class="inventory-expired-item"><strong>${esc(u.item?.name||"Artikel")}</strong><small>${esc(inventoryExpiredTrace(u))}</small></span>
        <span class="inventory-expired-qty"><small>Rest</small><b>${invNumber(u.remainingQuantity)}${u.item?.base_uom?` ${esc(u.item.base_uom)}`:""}</b></span>
        <span class="inventory-expired-state" data-expired-state>Prüfen</span>
      </label>`).join("")}</div>
      <div class="inventory-expired-confirm"><label><input type="checkbox" name="confirmed" required> <span>Ich habe die ausgewählten Einheiten physisch geprüft. Aora darf deren Restbestand als <strong>Ausschuss · MHD abgelaufen</strong> buchen.</span></label></div>
      <div class="actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit" data-expired-submit>Ausgewählte Einheiten ausbuchen</button></div>
    </form>`;
    const form=body.querySelector("form"),submit=form.querySelector("[data-expired-submit]");
    const updateSubmit=()=>{
      const selected=[...form.querySelectorAll('input[name="stockUnitId"]:checked:not(:disabled)')];
      submit.disabled=!selected.length;
      submit.textContent=selected.length?`${selected.length} Einheit${selected.length===1?"":"en"} ausbuchen`:"Keine Einheit ausgewählt";
    };
    form.addEventListener("change",e=>{if(e.target.matches('input[name="stockUnitId"]'))updateSubmit()});updateSubmit();

    form.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!form.reportValidity())return;
      const selected=[...form.querySelectorAll('input[name="stockUnitId"]:checked:not(:disabled)')];
      if(!selected.length)return toast("Bitte mindestens eine physisch geprüfte Einheit auswählen.","error");
      submit.disabled=true;
      const failures=[];
      let successCount=0;
      await runInventoryExpiryPool(selected,4,async input=>{
        const unit=units.find(x=>String(x.id)===String(input.value)),row=input.closest("[data-expired-row]"),state=row?.querySelector("[data-expired-state]"),operation=invStableOperationKey("expired-waste",`${input.value}:${unit?.expiresOn||"expired"}`);
        input.disabled=true;if(state){state.textContent="Bucht …";state.className="inventory-expired-state saving"}
        try{
          const result=await invRequest("wasteExpiredStockUnit",{locationId:S.locationId,stockUnitId:input.value,idempotencyKey:operation.key});
          operation.clear();successCount++;
          if(row)row.classList.add("done");
          if(state){state.textContent=result?.idempotent?"Bereits ausgebucht":"Ausgebucht";state.className="inventory-expired-state saved"}
        }catch(error){
          failures.push({id:input.value,message:error.message});input.disabled=false;
          if(state){state.textContent="Nicht gebucht";state.className="inventory-expired-state error"}
        }
      });
      if(successCount){S.inventoryPageCache={};}
      if(!failures.length){d.remove();toast(`${successCount} abgelaufene QR-Einheit${successCount===1?"":"en"} als Ausschuss gebucht.`);renderAdmin();return}
      toast(`${successCount} gebucht · ${failures.length} bitte erneut prüfen.`,failures.length?"error":undefined);
      const confirmed=form.querySelector('input[name="confirmed"]');if(confirmed)confirmed.checked=false;
      updateSubmit();
      if(successCount)renderAdmin();
    });
  }catch(error){d.querySelector("#expired-stock-body").innerHTML=`<div class="inventory-empty">${esc(error.message)}</div>`}
}

if(typeof inventoryInsightsSection==="function"){
  const _inventoryExpiryInsightsSection=inventoryInsightsSection;
  inventoryInsightsSection=function(insights){
    const html=_inventoryExpiryInsightsSection(insights),expired=Number(insights?.summary?.expiredItemCount||0),a=invAvailability(),allowed=Boolean(a?.features?.inventoryQr&&a?.permissions?.waste);
    if(!expired||!allowed)return html;
    const quantity=Number(insights?.summary?.expiredQuantity||0);
    return`${html}<section class="inventory-focus-banner inventory-expired-action"><div><span class="caps muted">MHD Aktion</span><strong>Abgelaufene QR-Einheiten physisch prüfen</strong><small>${expired} Artikel · ${invNumber(quantity)} gespeicherte QR-Restmenge. Aora bucht nichts automatisch aus.</small></div><button class="btn" type="button" data-inv="expired-review">Jetzt prüfen</button></section>`;
  };
}

app.addEventListener("click",e=>{const b=e.target.closest('[data-inv="expired-review"]');if(b)openExpiredStockReview()});
