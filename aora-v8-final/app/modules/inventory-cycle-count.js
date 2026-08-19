"use strict";

async function startInventoryConfidenceCycleCount(){
  const data=S.inventoryPageCache[`${invKey()}:overview`],items=(data?.insights?.items||[]).filter(x=>Number(x.confidenceScore)<60).sort((a,b)=>Number(a.confidenceScore)-Number(b.confidenceScore)).slice(0,50),itemIds=items.map(x=>x.itemId).filter(Boolean);
  if(!itemIds.length)return toast("Aktuell gibt es keine unsicheren Bestände, die eine Schnellinventur brauchen.");
  const button=app.querySelector('[data-inv="confidence-count"]');if(button)button.disabled=true;
  try{
    const r=await invRequest("startInventoryCount",{locationId:S.locationId,scope:"confidence_check",itemIds});
    if(r?.resumedDifferentScope)toast("Es läuft bereits eine Inventur. Aora setzt sie fort, statt parallel eine zweite zu starten.");
    else if(r?.resumed)toast("Offene Schnellinventur wird fortgesetzt.");
    else toast(`${r.lineCount||itemIds.length} unsichere Artikel für die Schnellinventur vorbereitet.`);
    openCountModal(r.countId);
  }catch(error){toast(error.message,"error");if(button)button.disabled=false}
}

if(typeof inventoryInsightsSection==="function"){
  const _inventoryInsightsSection=inventoryInsightsSection;
  inventoryInsightsSection=function(insights){
    const html=_inventoryInsightsSection(insights),low=(insights?.items||[]).filter(x=>Number(x.confidenceScore)<60).sort((a,b)=>Number(a.confidenceScore)-Number(b.confidenceScore)).slice(0,50);
    if(!low.length)return html;
    const names=low.slice(0,3).map(x=>x.item?.name||"Artikel").filter(Boolean).join(" · "),extra=Math.max(0,low.length-3);
    return`${html}<section class="inventory-focus-banner inventory-confidence-action"><div><span class="caps muted">Cycle Count</span><strong>Nur unsichere Bestände prüfen</strong><small>${esc(names)}${extra?` · +${extra} weitere`:""}. Aora startet eine blinde Schnellinventur nur für diese Artikel – nicht für das ganze Lager.</small></div><button class="btn" type="button" data-inv="confidence-count">${low.length} Artikel schnell prüfen</button></section>`;
  };
}

app.addEventListener("click",e=>{const b=e.target.closest('[data-inv="confidence-count"]');if(b)startInventoryConfidenceCycleCount()});
