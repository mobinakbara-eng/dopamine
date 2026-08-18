"use strict";

async function employeeScanAccessModal(){
  const d=modal(`${modalHeader("Bestand","QR-Scan für Mitarbeiter")}<div id="employee-scan-access"><div class="inventory-empty">Wird geladen …</div></div>`);
  try{
    const r=await invRequest("listEmployeeAccess",{locationId:S.locationId});
    d.querySelector("#employee-scan-access").innerHTML=(r.employees||[]).map(e=>`<label class="check-row" style="margin:8px 0"><input type="checkbox" data-employee-scan="${e.id}" ${e.scanEnabled?"checked":""}><span><strong>${esc(e.name)}</strong><small>${esc(e.roleTitle||"")}</small></span></label>`).join("")||'<div class="inventory-empty">Keine Mitarbeiter in diesem Laden.</div>';
  }catch(e){toast(e.message,"error")}
  d.addEventListener("change",async e=>{
    const i=e.target.closest("[data-employee-scan]");
    if(!i)return;
    i.disabled=true;
    try{
      await invRequest("setEmployeeAccess",{locationId:S.locationId,employeeId:i.dataset.employeeScan,enabled:i.checked});
      toast(i.checked?"Scan freigegeben.":"Scan-Zugriff entfernt.");
    }catch(err){i.checked=!i.checked;toast(err.message,"error")}
    finally{i.disabled=false}
  });
}

async function startCountFlow(){
  try{
    const r=await invRequest("startInventoryCount",{locationId:S.locationId,scope:"all"});
    if(r?.resumed)toast("Offene Inventur wird fortgesetzt.");
    openCountModal(r.countId);
  }catch(e){toast(e.message,"error")}
}

async function runCountPool(items,limit,worker){
  let cursor=0;
  const runners=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(cursor<items.length){
      const current=items[cursor++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function openCountModal(countId){
  const d=modal(`${modalHeader("Inventur","Bestand zählen")}<div id="count-body"><div class="inventory-empty">Zählung wird geladen …</div></div>`);
  try{
    const r=await invRequest("getInventoryCount",{countId});
    const body=d.querySelector("#count-body"),lines=r.lines||[];
    body.innerHTML=`<form class="inventory-count-form">
      <div class="inventory-count-intro">
        <div><strong>Blind zählen</strong><p>Der erwartete Systembestand bleibt verborgen. So wird wirklich gezählt statt bestätigt.</p></div>
        <div class="inventory-count-progress"><strong data-count-progress>0 / ${lines.length}</strong><span>gezählt</span></div>
      </div>
      <div class="inventory-count-grid">${lines.map(l=>{
        const hasBaseline=l.baselineVersion!=null&&l.countedQuantity!=null;
        const value=hasBaseline?String(l.countedQuantity):"";
        return`<label class="inventory-count-row" data-count-row="${l.item_id}">
          <span class="inventory-count-item"><strong>${esc(l.item?.name||"Artikel")}</strong><small>${esc([l.item?.sku,l.item?.category,l.item?.base_uom].filter(Boolean).join(" · "))}</small></span>
          <input class="input" inputmode="decimal" type="number" min="0" max="1000000000" step="0.001" value="${esc(value)}" placeholder="Menge" data-count-item="${l.item_id}" data-baseline="${hasBaseline?1:0}" autocomplete="off">
          <span class="inventory-count-save ${hasBaseline?"saved":""}" data-count-save>${hasBaseline?"Gespeichert":"Noch offen"}</span>
        </label>`;
      }).join("")}</div>
      <div class="inventory-count-footer">
        <p data-count-hint>Jede Position wird beim Eingeben automatisch gespeichert.</p>
        <div class="actions"><button type="button" class="btn outline" data-a="close">Später fortsetzen</button><button class="btn" type="submit">Inventur abschließen</button></div>
      </div>
    </form>`;

    const form=body.querySelector("form"),inputs=[...form.querySelectorAll("[data-count-item]")],states=new Map();
    for(const input of inputs)states.set(input.dataset.countItem,{timer:null,saving:null,lastSaved:input.dataset.baseline==="1"?input.value:null});

    const quantity=input=>{
      if(String(input.value).trim()==="")return null;
      const n=Number(input.value);
      return Number.isFinite(n)&&n>=0&&n<=1_000_000_000?n:null;
    };
    const status=(input,text,kind="")=>{
      const el=input.closest("[data-count-row]")?.querySelector("[data-count-save]");
      if(!el)return;
      el.textContent=text;
      el.className=`inventory-count-save ${kind}`.trim();
    };
    const updateProgress=()=>{
      const done=inputs.filter(i=>quantity(i)!==null).length;
      const el=form.querySelector("[data-count-progress]");
      if(el)el.textContent=`${done} / ${inputs.length}`;
    };
    const saveInput=async input=>{
      const st=states.get(input.dataset.countItem);
      if(!st)return;
      if(st.timer){clearTimeout(st.timer);st.timer=null}
      if(st.saving)await st.saving;
      const qty=quantity(input);
      if(qty===null){status(input,input.value?"Ungültig":"Noch offen",input.value?"error":"");return}
      const value=String(input.value);
      if(st.lastSaved===value&&input.dataset.baseline==="1"){status(input,"Gespeichert","saved");return}
      status(input,"Speichert …","saving");
      const request=invRequest("setInventoryCountLine",{countId,itemId:input.dataset.countItem,countedQuantity:qty});
      st.saving=request;
      try{
        await request;
        st.lastSaved=value;
        input.dataset.baseline="1";
        if(String(input.value)===value)status(input,"Gespeichert","saved");
        else status(input,"Geändert","");
      }catch(err){
        status(input,"Nicht gespeichert","error");
        throw err;
      }finally{
        st.saving=null;
        if(String(input.value)!==st.lastSaved&&quantity(input)!==null){
          st.timer=setTimeout(()=>saveInput(input).catch(err=>toast(err.message,"error")),500);
        }
      }
    };
    const scheduleSave=input=>{
      const st=states.get(input.dataset.countItem);
      if(!st)return;
      if(st.timer)clearTimeout(st.timer);
      if(quantity(input)===null){status(input,input.value?"Ungültig":"Noch offen",input.value?"error":"");return}
      status(input,"Geändert","");
      st.timer=setTimeout(()=>saveInput(input).catch(err=>toast(err.message,"error")),450);
    };

    inputs.forEach(input=>{
      input.addEventListener("input",()=>{updateProgress();scheduleSave(input)});
      input.addEventListener("blur",()=>{if(quantity(input)!==null)saveInput(input).catch(err=>toast(err.message,"error"))});
    });
    updateProgress();

    form.addEventListener("submit",async e=>{
      e.preventDefault();
      const btn=e.currentTarget.querySelector('button[type="submit"]'),missing=inputs.filter(i=>quantity(i)===null);
      if(missing.length){
        missing[0].focus();
        return toast(`Noch ${missing.length} Position${missing.length===1?"":"en"} zählen.`,"error");
      }
      btn.disabled=true;
      form.querySelector("[data-count-hint]").textContent="Letzte Änderungen werden sicher gespeichert …";
      try{
        await runCountPool(inputs,6,saveInput);
        form.querySelector("[data-count-hint]").textContent="Inventur wird verbucht …";
        await invRequest("postInventoryCount",{countId,expectedVersion:Number(r.count.version)});
        d.remove();
        S.inventoryPageCache={};
        toast("Inventur wurde gebucht.");
        renderAdmin();
      }catch(err){
        toast(err.message,"error");
        form.querySelector("[data-count-hint]").textContent="Nicht alle Änderungen konnten gespeichert werden. Bitte die markierten Positionen prüfen.";
        btn.disabled=false;
      }
    });
  }catch(e){
    d.querySelector("#count-body").innerHTML=`<div class="inventory-empty">${esc(e.message)}</div>`;
  }
}

managerAccessModal=async function(manager){
  let access={fullLocationIds:[]};
  try{access=await invRequest("listManagerAccess",{managerId:manager.id})}catch{}
  const locations=activeLocations(),current=new Set(manager.locationIds||[]),full=new Set(access.fullLocationIds||[]),d=modal(`${modalHeader("Inhaber","Manager-Zugriff ändern")}<form class="form-grid"><div class="field full manager-modal-summary"><div class="avatar">${esc(manager.initials||initials(manager.name))}</div><span><strong>${esc(manager.name)}</strong><small>${esc(manager.email||"")}</small></span></div><fieldset class="field full checkbox-fieldset"><legend>Zugewiesene Läden</legend>${locations.map(l=>`<label class="check-row"><input type="checkbox" name="locationIds" value="${l.id}" ${current.has(l.id)?"checked":""}><span><strong>${esc(l.name)}</strong><small>${esc(l.city||"")}</small></span></label>`).join("")}</fieldset><div class="field full inventory-access-box"><label class="inventory-access-toggle"><input type="checkbox" name="inventoryFull" ${full.size?"checked":""}><span><strong>Vollzugriff Bestand & Bestellung</strong><small>Bestand, Wareneingang, Transfers, Inventur, Lieferanten, Bestellung, QR und Scan-Freigaben.</small></span></label><div class="inventory-access-locations">${locations.map(l=>`<label><input type="checkbox" name="inventoryLocationIds" value="${l.id}" ${full.has(l.id)?"checked":""}> ${esc(l.name)}</label>`).join("")}</div></div><div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Zugriff speichern</button></div></form>`);
  d.querySelector("form").addEventListener("submit",async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget),locationIds=f.getAll("locationIds"),enabled=f.get("inventoryFull")!==null,inventoryLocationIds=enabled?f.getAll("inventoryLocationIds").filter(id=>locationIds.includes(id)):[];
    if(!locationIds.length)return toast("Mindestens ein Laden ist erforderlich.","error");
    try{
      await apply({type:"UPDATE_MANAGER_ACCESS",id:manager.id,locationIds});
      await invRequest("setManagerFullAccess",{managerId:manager.id,locationIds:inventoryLocationIds});
      d.remove();
      S.inventoryAvailabilityCache={};
      toast("Manager-Zugriff gespeichert.");
    }catch(err){toast(err.message,"error")}
  });
};

app.addEventListener("click",e=>{
  const b=e.target.closest("[data-inv]");
  if(!b)return;
  if(b.dataset.inv==="employee-access")employeeScanAccessModal();
  else if(b.dataset.inv==="start-count")startCountFlow();
});
