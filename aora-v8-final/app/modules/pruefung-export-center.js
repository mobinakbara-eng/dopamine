"use strict";

(function installPruefungExportCenter(){
  const VIEW="approvals";
  const LEGACY_VIEW="compliance";
  const FUNCTION_NAME="aora-v8-datev-hours-export";
  const datevState={loading:false,loadedAt:0,error:"",data:null,period:""};

  function currentPeriod(){
    const value=typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10);
    return String(value).slice(0,7);
  }
  datevState.period=currentPeriod();
  const html=value=>typeof esc==="function"?esc(value??""):String(value??"");
  const isTargetView=()=>S.adminView===VIEW||S.adminView===LEGACY_VIEW;
  const formatHours=minutes=>{
    const total=Math.max(0,Math.round(Number(minutes)||0));
    return`${Math.floor(total/60)}:${String(total%60).padStart(2,"0")} Std.`;
  };

  function retargetNavigation(list){
    if(!Array.isArray(list))return;
    const existing=list.find(item=>item?.[0]===VIEW);
    const legacy=list.find(item=>item?.[0]===LEGACY_VIEW);
    if(existing){
      existing[1]="Prüfung & Exporte";
      if(legacy&&legacy!==existing)list.splice(list.indexOf(legacy),1);
      return;
    }
    if(legacy){legacy[0]=VIEW;legacy[1]="Prüfung & Exporte"}
  }
  retargetNavigation(typeof managerNav!=="undefined"?managerNav:null);
  retargetNavigation(typeof ownerNav!=="undefined"?ownerNav:null);

  const previousAdminTitle=adminTitle;
  const previousAdminView=adminView;
  adminTitle=function(){return isTargetView()?"Prüfung & Exporte":previousAdminTitle()};

  async function call(action,payload={}){
    const result=await request(FUNCTION_NAME,{action,period:datevState.period,token:S.session?.token,...payload});
    if(result?.ok===false)throw Object.assign(new Error(result.message||result.error||"DATEV-Stundenexport fehlgeschlagen."),{code:result.error,details:result.details});
    return result?.result??result;
  }
  async function ensureDatevData(force=false){
    if(datevState.loading)return;
    if(!force&&datevState.loadedAt&&Date.now()-datevState.loadedAt<12000)return;
    datevState.loading=true;datevState.error="";
    try{datevState.data=await call("status");datevState.loadedAt=Date.now()}
    catch(error){datevState.error=error?.message||"DATEV-Stundenexport konnte nicht geladen werden."}
    finally{datevState.loading=false;if(S.session&&isTargetView())renderAdmin()}
  }

  function datevStatusPill(){
    const data=datevState.data,totals=data?.totals||{};
    if(datevState.loading)return'<span class="status-chip">Wird geprüft</span>';
    if(datevState.error)return'<span class="status-chip danger">Fehler</span>';
    if(!data?.settings)return'<span class="status-chip">Einrichtung offen</span>';
    if(Number(totals.openEntries)>0||Number(totals.missingPersonnelNumbers)>0)return'<span class="status-chip">Prüfung nötig</span>';
    if(Number(totals.minutes)>0)return'<span class="status-chip black">Bereit</span>';
    return'<span class="status-chip">Keine Stunden</span>';
  }
  function readinessNotice(){
    const data=datevState.data,totals=data?.totals||{};
    if(datevState.error)return`<div class="pruefung-alert error"><strong>DATEV-Ausgabe nicht verfügbar.</strong><span>${html(datevState.error)}</span></div>`;
    if(!data)return'<div class="pruefung-alert"><strong>Daten werden geprüft …</strong></div>';
    const notes=[];
    if(!data.settings)notes.push("Beraternummer, Mandantennummer und Lohnart Arbeitsstunden fehlen noch.");
    if(Number(totals.openEntries)>0)notes.push(`${Number(totals.openEntries)} offene/laufende Buchung${Number(totals.openEntries)===1?"":"en"} muss zuerst abgeschlossen werden.`);
    if(Number(totals.missingPersonnelNumbers)>0)notes.push(`${Number(totals.missingPersonnelNumbers)} DATEV-Personalnummer${Number(totals.missingPersonnelNumbers)===1?" fehlt":"n fehlen"}.`);
    if(!Number(totals.minutes)&&!Number(totals.openEntries))notes.push("Im gewählten Monat sind noch keine Arbeitsstunden vorhanden.");
    if(!notes.length)return'<div class="pruefung-alert ok"><strong>Bereit für den Stundenexport.</strong><span>Es werden ausschließlich abgeschlossene Arbeitsstunden ausgegeben.</span></div>';
    return`<div class="pruefung-alert"><strong>Vor dem Export prüfen:</strong><ul>${notes.map(note=>`<li>${html(note)}</li>`).join("")}</ul></div>`;
  }
  function employeeMappingRows(){
    const employees=(datevState.data?.employees||[]).filter(item=>item.included);
    if(!employees.length)return'<div class="empty">Für diesen Monat gibt es keine Mitarbeiter mit Arbeitszeitbuchungen.</div>';
    return`<div class="datev-hours-mapping-list">${employees.map(employee=>`<label class="datev-hours-mapping-row">
      <span><strong>${html(employee.name)}</strong><small>${html(formatHours(employee.minutes))}${employee.openEntries?` · ${employee.openEntries} offen`:""}</small></span>
      <input class="input" name="personnel-${html(employee.id)}" inputmode="numeric" pattern="[0-9]{1,9}" maxlength="9" autocomplete="off" placeholder="Personalnr." value="${html(employee.personnelNumber||"")}">
    </label>`).join("")}</div>`;
  }
  function configForm(){
    const data=datevState.data,settings=data?.settings||{};
    if(!data)return"";
    if(!data.canConfigure){
      return`<dl class="datev-hours-readonly"><div><dt>Beraternummer</dt><dd>${html(settings.berater_number||"–")}</dd></div><div><dt>Mandantennummer</dt><dd>${html(settings.mandant_number||"–")}</dd></div><div><dt>Lohnart Arbeitsstunden</dt><dd>${html(settings.regular_wage_type||"–")}</dd></div></dl>`;
    }
    return`<form id="datev-hours-config-form" class="datev-hours-config-form">
      <div class="datev-hours-config-grid">
        <label>Beraternummer<input class="input" name="beraterNumber" inputmode="numeric" pattern="[0-9]{4,7}" minlength="4" maxlength="7" autocomplete="off" value="${html(settings.berater_number||"")}" required></label>
        <label>Mandantennummer<input class="input" name="mandantNumber" inputmode="numeric" pattern="[0-9]{1,5}" minlength="1" maxlength="5" autocomplete="off" value="${html(settings.mandant_number||"")}" required></label>
        <label>Lohnart Arbeitsstunden<input class="input" name="regularWageType" inputmode="numeric" pattern="[0-9]{1,4}" minlength="1" maxlength="4" autocomplete="off" placeholder="Vom Steuerberater" value="${html(settings.regular_wage_type||"")}" required></label>
      </div>
      <div class="datev-hours-config-head"><strong>DATEV-Personalnummern</strong><small>Nur Mitarbeiter mit Stunden im gewählten Monat werden benötigt.</small></div>
      ${employeeMappingRows()}
      <div class="datev-hours-config-actions"><button class="btn outline" type="submit">DATEV-Zuordnung speichern</button></div>
    </form>`;
  }
  function datevCard(){
    const data=datevState.data,totals=data?.totals||{};
    const canExport=Boolean(data?.settings)&&Number(totals.minutes)>0&&Number(totals.openEntries)===0&&Number(totals.missingPersonnelNumbers)===0;
    return`<article class="dashboard-card datev-hours-card">
      <div class="datev-hours-head"><div><div class="caps">Nur Arbeitsstunden · DATEV LODAS</div><h2>DATEV-Stundenexport</h2><p>Eine monatliche LODAS-ASCII-Datei mit Personalnummer, Lohnart und Stunden. Keine Audit-JSONs, keine allgemeinen CSV-Exporte und keine zusätzlichen Payroll-Daten.</p></div>${datevStatusPill()}</div>
      <div class="datev-hours-toolbar"><label>Abrechnungsmonat<input class="input" id="datev-hours-period" type="month" value="${html(datevState.period)}"></label><div class="datev-hours-total"><span>Arbeitszeit</span><strong>${html(formatHours(totals.minutes||0))}</strong><small>${Number(totals.employees||0)} Mitarbeiter</small></div><button class="btn" data-datev-hours-action="export" ${canExport?"":"disabled"}>DATEV Stundenexport (.txt)</button></div>
      ${readinessNotice()}
      <details class="datev-hours-settings" ${data?.settings?"":"open"}><summary>DATEV-Zuordnung</summary>${configForm()}</details>
      <p class="datev-hours-footnote">Format: LODAS Bewegungsdaten Standardbuchungen · Buchungsschlüssel 01 (Stunden). Die Lohnart wird nicht von AORA geraten, sondern einmalig mit dem Steuerberater festgelegt.</p>
    </article>`;
  }

  function signingSection(){
    const signingMarkup=previousAdminView();
    return`<section class="pruefung-signing-section"><header><div><div class="caps">Mitarbeiter-Bestätigung</div><h2>Nachweise prüfen und Unterschrift anfordern</h2><p>Alle managerseitigen Schritte für den Arbeitszeitnachweis und die einmalige Mitarbeiterunterschrift sind hier gebündelt. Im Bereich „Arbeitszeit“ gibt es dafür keinen zweiten Einstieg mehr.</p></div></header><div class="pruefung-signing-legacy">${signingMarkup}</div></section>`;
  }
  function page(){
    queueMicrotask(()=>ensureDatevData());
    return`<section id="aora-pruefung-export-center" class="pruefung-export-center">
      <header class="pruefung-export-hero"><div><div class="caps">Prüfung & Exporte</div><h2>Stunden für DATEV. Nachweise für Mitarbeiter.</h2><p>Ein klarer Abschlussbereich: DATEV bekommt nur die relevanten Arbeitsstunden; Mitarbeiterbestätigungen und Unterschriften werden direkt darunter verwaltet.</p></div><button class="btn light" data-datev-hours-action="refresh">Aktualisieren</button></header>
      ${datevCard()}
      ${signingSection()}
    </section>`;
  }

  adminView=function(){
    if(S.adminView===LEGACY_VIEW)S.adminView=VIEW;
    if(S.adminView===VIEW)return page();
    return previousAdminView();
  };

  async function downloadExport(){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(`${CFG.url}/functions/v1/${FUNCTION_NAME}`,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=UTF-8"},
        body:JSON.stringify({action:"export",period:datevState.period,token:S.session?.token}),
        signal:controller.signal
      });
      if(!response.ok){
        let payload={};try{payload=await response.json()}catch{}
        const error=new Error(payload.message||payload.error||`HTTP ${response.status}`);error.details=payload.details;throw error;
      }
      const blob=await response.blob(),disposition=response.headers.get("content-disposition")||"";
      const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`AORA_DATEV_LODAS_STUNDEN_${datevState.period}.txt`;
      const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      return{filename,checksum:response.headers.get("x-aora-export-checksum")};
    }catch(error){if(error?.name==="AbortError")throw new Error("DATEV-Stundenexport hat zu lange gedauert.");throw error}
    finally{clearTimeout(timeout)}
  }
  async function saveConfig(form){
    const data=new FormData(form),employeeMappings=[];
    for(const employee of datevState.data?.employees||[]){
      if(!employee.included)continue;
      employeeMappings.push({
        employeeId:String(employee.id),
        personnelNumber:String(data.get(`personnel-${employee.id}`)||"").trim()
      });
    }
    await call("save_config",{
      beraterNumber:String(data.get("beraterNumber")||"").trim(),
      mandantNumber:String(data.get("mandantNumber")||"").trim(),
      regularWageType:String(data.get("regularWageType")||"").trim(),
      employeeMappings
    });
    datevState.loadedAt=0;await ensureDatevData(true);
  }

  document.addEventListener("change",event=>{
    if(event.target?.id!=="datev-hours-period")return;
    const value=String(event.target.value||"");if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return;
    datevState.period=value;datevState.loadedAt=0;datevState.data=null;ensureDatevData(true);
  });
  document.addEventListener("submit",async event=>{
    if(event.target?.id!=="datev-hours-config-form")return;
    event.preventDefault();
    const submit=event.target.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
    try{await saveConfig(event.target);toast("DATEV-Zuordnung wurde gespeichert.","success")}
    catch(error){toast(error?.message||"DATEV-Zuordnung konnte nicht gespeichert werden.","error")}
    finally{if(submit?.isConnected)submit.disabled=false}
  });
  document.addEventListener("click",async event=>{
    const button=event.target.closest("[data-datev-hours-action]");if(!button)return;
    const action=button.dataset.datevHoursAction;button.disabled=true;
    try{
      if(action==="refresh"){datevState.loadedAt=0;await ensureDatevData(true)}
      if(action==="export"){const result=await downloadExport();toast(`${result.filename} wurde erstellt.`,"success")}
    }catch(error){toast(error?.message||"DATEV-Aktion fehlgeschlagen.","error")}
    finally{if(button.isConnected)button.disabled=false}
  });
})();
