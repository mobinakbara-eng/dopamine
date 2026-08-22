"use strict";

(function installPruefungExportCenter(){
  const VIEW="compliance";
  const SIGNING_VIEW="approvals";
  const FUNCTION_NAME="aora-v8-datev-hours-export";
  const datevState={loading:false,loadedAt:0,error:"",data:null,period:"",contextKey:"",exportKeys:{}};

  function currentPeriod(){
    const value=typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10);
    return String(value).slice(0,7);
  }
  datevState.period=currentPeriod();

  const html=value=>typeof esc==="function"?esc(value??""):String(value??"");
  const isTargetView=()=>S.adminView===VIEW||S.adminView===SIGNING_VIEW;
  const formatHours=minutes=>{
    const total=Math.max(0,Math.round(Number(minutes)||0));
    return`${Math.floor(total/60)}:${String(total%60).padStart(2,"0")} Std.`;
  };

  function normalizeNavigation(list){
    if(!Array.isArray(list))return;
    const signing=list.find(item=>item?.[0]===SIGNING_VIEW);
    const compliance=list.find(item=>item?.[0]===VIEW);
    if(signing){
      signing[1]="Prüfung & Exporte";
      if(compliance&&compliance!==signing)list.splice(list.indexOf(compliance),1);
      return;
    }
    if(compliance){compliance[0]=SIGNING_VIEW;compliance[1]="Prüfung & Exporte"}
  }
  normalizeNavigation(typeof managerNav!=="undefined"?managerNav:null);
  normalizeNavigation(typeof ownerNav!=="undefined"?ownerNav:null);

  const previousAdminTitle=adminTitle;
  const previousAdminView=adminView;
  adminTitle=function(){return isTargetView()?"Prüfung & Exporte":previousAdminTitle()};

  async function call(action,payload={}){
    const result=await request(FUNCTION_NAME,{action,period:datevState.period,token:S.session?.token,...payload});
    if(result?.ok===false)throw Object.assign(new Error(result.message||result.error||"DATEV-Stundenexport fehlgeschlagen."),{code:result.error,details:result.details});
    return result?.result??result;
  }

  async function ensureDatevData(force=false){
    const contextKey=`${String(S.session?.token||"")}:${datevState.period}`;
    if(datevState.contextKey!==contextKey){datevState.contextKey=contextKey;datevState.loadedAt=0;datevState.data=null;datevState.error=""}
    if(datevState.loading===contextKey)return;
    if(!force&&datevState.loadedAt&&Date.now()-datevState.loadedAt<12000)return;
    datevState.loading=contextKey;
    datevState.error="";
    try{
      const result=await call("status");
      if(`${String(S.session?.token||"")}:${datevState.period}`!==contextKey)return;
      datevState.data=result;
      datevState.loadedAt=Date.now();
    }catch(error){
      if(`${String(S.session?.token||"")}:${datevState.period}`===contextKey)datevState.error=error?.message||"DATEV-Stundenexport konnte nicht geladen werden.";
    }finally{
      if(datevState.loading===contextKey)datevState.loading=false;
      if(`${String(S.session?.token||"")}:${datevState.period}`===contextKey&&S.session&&isTargetView())renderAdmin();
    }
  }

  function statusPill(){
    const totals=datevState.data?.totals||{};
    if(datevState.loading)return'<span class="status-chip">Prüfung …</span>';
    if(datevState.error)return'<span class="status-chip danger">Nicht verfügbar</span>';
    if(!datevState.data?.settings)return'<span class="status-chip">Einrichtung offen</span>';
    if(Number(totals.openEntries)>0||Number(totals.missingPersonnelNumbers)>0)return'<span class="status-chip">Prüfung nötig</span>';
    if(Number(totals.minutes)>0)return'<span class="status-chip black">Bereit</span>';
    return'<span class="status-chip">Keine Stunden</span>';
  }

  function readinessNotice(){
    const data=datevState.data,totals=data?.totals||{},final=data?.finalReadiness||{};
    if(datevState.error)return`<div class="pruefung-alert error"><strong>DATEV-Ausgabe nicht verfügbar.</strong><span>${html(datevState.error)}</span></div>`;
    if(!data)return'<div class="pruefung-alert"><span>Daten werden geprüft …</span></div>';
    const notes=[];
    if(!data.settings)notes.push("DATEV-Zuordnung einmalig einrichten.");
    if(Number(totals.openEntries)>0)notes.push(`${Number(totals.openEntries)} offene/laufende Buchung${Number(totals.openEntries)===1?"":"en"} zuerst abschließen.`);
    if(Number(totals.missingPersonnelNumbers)>0)notes.push(`${Number(totals.missingPersonnelNumbers)} DATEV-Personalnummer${Number(totals.missingPersonnelNumbers)===1?" fehlt":"n fehlen"}.`);
    if(Number(final.missingApprovedSnapshots)>0)notes.push(`${Number(final.missingApprovedSnapshots)} bestätigte${Number(final.missingApprovedSnapshots)===1?"r Arbeitszeitnachweis fehlt":" Arbeitszeitnachweise fehlen"}.`);
    if(Number(final.pendingCorrections)>0)notes.push(`${Number(final.pendingCorrections)} offene Zeitkorrektur${Number(final.pendingCorrections)===1?"":"en"} blockiert den finalen Export.`);
    if(Number(final.invalidSnapshots)>0||Number(final.openDays)>0)notes.push("Bestätigte Nachweise enthalten offene Tage oder haben die Integritätsprüfung nicht bestanden.");
    if(!Number(totals.minutes)&&!Number(totals.openEntries))notes.push("Im gewählten Monat sind noch keine abgeschlossenen Stunden vorhanden.");
    if(!notes.length)return'<div class="pruefung-alert ok"><strong>Export bereit.</strong><span>Es werden nur abgeschlossene Arbeitsstunden ausgegeben. Fachliche DATEV-Validierung erfolgt erst nach erfolgreichem Testimport in LODAS.</span></div>';
    return`<div class="pruefung-alert"><strong>Vor dem Export</strong><ul>${notes.map(note=>`<li>${html(note)}</li>`).join("")}</ul></div>`;
  }

  function employeeMappingRows(){
    const employees=(datevState.data?.employees||[]).filter(item=>item.included);
    if(!employees.length)return'<div class="empty">Keine Mitarbeiter mit Arbeitszeit im gewählten Monat.</div>';
    return`<div class="datev-hours-mapping-list">${employees.map(employee=>`<label class="datev-hours-mapping-row">
      <span><strong>${html(employee.name)}</strong><small>${html(formatHours(employee.minutes))}${employee.openEntries?` · ${employee.openEntries} offen`:""}</small></span>
      <input class="input" name="personnel-${html(employee.id)}" inputmode="numeric" pattern="[0-9]{1,5}" maxlength="5" autocomplete="off" placeholder="Personalnr." value="${html(employee.personnelNumber||"")}">
    </label>`).join("")}</div>`;
  }

  function configForm(){
    const data=datevState.data,settings=data?.settings||{};
    if(!data)return"";
    if(!data.canConfigure){
      return`<dl class="datev-hours-readonly"><div><dt>Beraternummer</dt><dd>${html(settings.berater_number||"–")}</dd></div><div><dt>Mandantennummer</dt><dd>${html(settings.mandant_number||"–")}</dd></div><div><dt>Lohnart Stunden</dt><dd>${html(settings.regular_wage_type||"–")}</dd></div></dl>`;
    }
    return`<form id="datev-hours-config-form" class="datev-hours-config-form">
      <div class="datev-hours-config-grid">
        <label>Beraternummer<input class="input" name="beraterNumber" inputmode="numeric" pattern="[0-9]{4,7}" minlength="4" maxlength="7" autocomplete="off" value="${html(settings.berater_number||"")}" required></label>
        <label>Mandantennummer<input class="input" name="mandantNumber" inputmode="numeric" pattern="[0-9]{1,5}" minlength="1" maxlength="5" autocomplete="off" value="${html(settings.mandant_number||"")}" required></label>
        <label>Lohnart Arbeitsstunden<input class="input" name="regularWageType" inputmode="numeric" pattern="[0-9]{1,4}" minlength="1" maxlength="4" autocomplete="off" placeholder="Vom Steuerberater" value="${html(settings.regular_wage_type||"")}" required></label>
      </div>
      <div class="datev-hours-config-head"><strong>Personalnummern</strong><small>1–99999 · nur für Mitarbeiter mit Stunden in diesem Monat.</small></div>
      ${employeeMappingRows()}
      <div class="datev-hours-config-actions"><button class="btn outline" type="submit">Zuordnung speichern</button></div>
    </form>`;
  }

  function datevCard(){
    const data=datevState.data,totals=data?.totals||{},final=data?.finalReadiness||{};
    const canDraft=Boolean(data?.settings)&&Number(totals.minutes)>0&&Number(totals.openEntries)===0&&Number(totals.missingPersonnelNumbers)===0,canFinal=Boolean(data?.settings)&&Boolean(final.ready);
    return`<article class="dashboard-card datev-hours-card">
      <div class="datev-hours-head"><div><div class="caps">DATEV LODAS</div><h2>Arbeitsstunden exportieren</h2><p>Nur die für den Stundenimport benötigten Monatswerte. Keine internen IDs, Audit-Felder oder technischen Spalten.</p></div>${statusPill()}</div>
      <div class="datev-hours-toolbar">
        <label>Monat<input class="input" id="datev-hours-period" type="month" value="${html(datevState.period)}"></label>
        <div class="datev-hours-total"><span>Arbeitszeit</span><strong>${html(formatHours(totals.minutes||0))}</strong><small>${Number(totals.employees||0)} Mitarbeiter</small></div>
        <button class="btn outline" data-datev-hours-action="export" data-export-mode="draft" ${canDraft?"":"disabled"}>Entwurf prüfen</button>
        <button class="btn" data-datev-hours-action="export" data-export-mode="final" ${canFinal?"":"disabled"}>Finale DATEV-Datei</button>
      </div>
      ${readinessNotice()}
      <details class="datev-hours-settings" ${data?.settings?"":"open"}><summary>DATEV-Zuordnung</summary>${configForm()}</details>
      <p class="datev-hours-footnote">Entwurf = aktueller, noch veränderbarer Stand. Final = nur bestätigte und unveränderbare Arbeitszeitnachweise ohne offene Korrekturen. LODAS-Testimport steht weiterhin aus.</p>
    </article>`;
  }

  function signingSection(){
    return`<section class="pruefung-signing-section">
      <header><div><div class="caps">Mitarbeiter-Bestätigung</div><h2>Arbeitszeitnachweise & Unterschriften</h2><p>Nachweis auswählen, prüfen und bei Bedarf gezielt zur Unterschrift an den Mitarbeiter senden.</p></div></header>
      <div class="pruefung-signing-legacy">${previousAdminView()}</div>
    </section>`;
  }

  function page(){
    queueMicrotask(()=>ensureDatevData());
    return`<section id="aora-pruefung-export-center" class="pruefung-export-center">
      <div class="pruefung-export-intro"><div><div class="caps">Monatsabschluss</div><h2>Prüfung & Exporte</h2><p>DATEV-Stunden und Mitarbeiterbestätigungen an einem Ort.</p></div><button class="btn light" data-datev-hours-action="refresh">Aktualisieren</button></div>
      ${datevCard()}
      ${signingSection()}
    </section>`;
  }

  adminView=function(){
    if(S.adminView===VIEW)S.adminView=SIGNING_VIEW;
    if(S.adminView===SIGNING_VIEW)return page();
    return previousAdminView();
  };

  async function downloadExport(mode){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(`${CFG.url}/functions/v1/${FUNCTION_NAME}`,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=UTF-8"},
        body:JSON.stringify({action:"export",mode,period:datevState.period,idempotencyKey:datevState.exportKeys[`${datevState.period}:${mode}`]||(datevState.exportKeys[`${datevState.period}:${mode}`]=crypto.randomUUID()),token:S.session?.token}),
        signal:controller.signal
      });
      if(!response.ok){
        let payload={};
        try{payload=await response.json()}catch{}
        const error=new Error(payload.message||payload.error||`HTTP ${response.status}`);
        error.details=payload.details;
        throw error;
      }
      const blob=await response.blob(),disposition=response.headers.get("content-disposition")||"";
      const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`AORA_DATEV_LODAS_STUNDEN_${mode==="draft"?"ENTWURF_":""}${datevState.period}.txt`;
      const url=URL.createObjectURL(blob),anchor=document.createElement("a");
      anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      return{filename,checksum:response.headers.get("x-aora-export-checksum"),validation:response.headers.get("x-aora-datev-validation")};
    }catch(error){
      if(error?.name==="AbortError")throw new Error("DATEV-Stundenexport hat zu lange gedauert.");
      throw error;
    }finally{clearTimeout(timeout)}
  }

  async function saveConfig(form){
    const data=new FormData(form),employeeMappings=[];
    for(const employee of datevState.data?.employees||[]){
      if(!employee.included)continue;
      employeeMappings.push({employeeId:String(employee.id),personnelNumber:String(data.get(`personnel-${employee.id}`)||"").trim()});
    }
    await call("save_config",{
      expectedVersion:Number(datevState.data?.settings?.version||0),
      beraterNumber:String(data.get("beraterNumber")||"").trim(),
      mandantNumber:String(data.get("mandantNumber")||"").trim(),
      regularWageType:String(data.get("regularWageType")||"").trim(),
      employeeMappings
    });
    datevState.loadedAt=0;
    await ensureDatevData(true);
  }

  document.addEventListener("change",event=>{
    if(event.target?.id!=="datev-hours-period")return;
    const value=String(event.target.value||"");
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return;
    datevState.period=value;
    datevState.loadedAt=0;
    datevState.data=null;
    ensureDatevData(true);
  });

  document.addEventListener("submit",async event=>{
    if(event.target?.id!=="datev-hours-config-form")return;
    event.preventDefault();
    const submit=event.target.querySelector('button[type="submit"]');
    if(submit)submit.disabled=true;
    try{
      await saveConfig(event.target);
      toast("DATEV-Zuordnung wurde gespeichert.","success");
    }catch(error){
      toast(error?.message||"DATEV-Zuordnung konnte nicht gespeichert werden.","error");
    }finally{
      if(submit?.isConnected)submit.disabled=false;
    }
  });

  document.addEventListener("click",async event=>{
    const button=event.target.closest("[data-datev-hours-action]");
    if(!button)return;
    const action=button.dataset.datevHoursAction;
    button.disabled=true;
    try{
      if(action==="refresh"){
        datevState.loadedAt=0;
        await ensureDatevData(true);
      }
      if(action==="export"){
        const mode=button.dataset.exportMode==="draft"?"draft":"final",result=await downloadExport(mode);
        toast(`${result.filename} wurde erstellt${mode==="draft"?" (Entwurf)":""}. DATEV-Testimport steht noch aus.`,"success");
      }
    }catch(error){
      toast(error?.message||"DATEV-Aktion fehlgeschlagen.","error");
    }finally{
      if(button.isConnected)button.disabled=false;
    }
  });
})();
