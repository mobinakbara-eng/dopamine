"use strict";

(function installPayrollCenter(){
  if(window.__aoraPayrollCenterInstalled)return;
  window.__aoraPayrollCenterInstalled=true;
  const FUNCTION_NAME="aora-v8-payroll-center";
  const state={data:null,preview:null,loading:false,saving:false,error:"",month:(typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10)).slice(0,7)};
  const dayKeys=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const dayLabels=["Mo","Di","Mi","Do","Fr","Sa","So"];
  const defaultMappings={regular:"Arbeitsstunden",night:"Nachtstunden",sunday:"Sonntagsstunden",holiday:"Feiertagsstunden",vacation:"Urlaub",sickness:"Krankheit",correction:"Korrektur"};

  if(typeof managerNav!=="undefined"&&!managerNav.some(([id])=>id==="payroll")){
    const index=managerNav.findIndex(([id])=>id==="reports");
    managerNav.splice(index<0?managerNav.length:index,0,["payroll","Lohnvorbereitung",I.chart]);
  }
  if(typeof ownerNav!=="undefined"&&!ownerNav.some(([id])=>id==="payroll")){
    const index=ownerNav.findIndex(([id])=>id==="reports");
    ownerNav.splice(index<0?ownerNav.length:index,0,["payroll","Lohnvorbereitung",I.chart]);
  }
  const previousTitle=adminTitle;
  adminTitle=function(){return S.adminView==="payroll"?"Lohnvorbereitung":previousTitle()};
  const previousView=adminView;
  adminView=function(){return S.adminView==="payroll"?payrollPage():previousView()};

  function call(action,payload={}){return request(FUNCTION_NAME,{action,token:S.session?.token,...payload})}
  function splitMonth(){const [year,month]=String(state.month).split("-").map(Number);return{year,month}}
  function fmtMinutes(value){const minutes=Math.round(Number(value)||0),sign=minutes<0?"−":"",abs=Math.abs(minutes);return`${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`}
  function fmtDate(value){if(!value)return"–";try{return new Date(value).toLocaleString("de-DE")}catch{return esc(value)}}
  function currentPeriod(){const {year,month}=splitMonth();return(state.data?.periods||[]).find(item=>Number(item.year)===year&&Number(item.month)===month)}
  function currentExport(){const period=currentPeriod();return period?(state.data?.exports||[]).find(item=>String(item.payroll_period_id)===String(period.id)):null}
  function scheduleValue(employee,key){return Number(employee.schedule?.[`${key}_minutes`]||0)/60}
  function mapping(type){return(state.data?.mappings||[]).find(item=>item.source_type===type&&item.payroll_system===(state.data?.profile?.payroll_system||"generic_excel"))||{source_type:type,label:defaultMappings[type],external_wage_type:""}}

  async function load(force=false){
    if(state.loading)return;
    if(!force&&state.data)return;
    state.loading=true;state.error="";
    try{state.data=await call("overview")}
    catch(error){state.error=error.message||"Lohnvorbereitung konnte nicht geladen werden."}
    finally{state.loading=false;if(S.adminView==="payroll"&&S.session)renderAdmin()}
  }

  function setupStatus(){
    const employees=state.data?.employees||[];
    const ready=employees.filter(item=>item.payrollIdentity?.personnel_number&&item.schedule&&dayKeys.some(key=>Number(item.schedule?.[`${key}_minutes`]||0)>0)).length;
    return{ready,total:employees.length,complete:employees.length>0&&ready===employees.length};
  }
  function stepCard(number,title,text,active,done){return`<article class="payroll-step ${active?"active":""} ${done?"done":""}"><b>${done?"✓":number}</b><span><strong>${esc(title)}</strong><small>${esc(text)}</small></span></article>`}
  function payrollPage(){
    queueMicrotask(()=>load());
    if(state.loading&&!state.data)return`${head("Lohnvorbereitung","Arbeitszeiten einfach prüfen und für den Steuerberater vorbereiten.")}<div class="payroll-loading">Daten werden geladen …</div>`;
    const data=state.data||{},profile=data.profile||{},employees=data.employees||[],status=setupStatus(),period=currentPeriod(),exportRow=currentExport(),preview=state.preview;
    return `<div class="payroll-hero"><div><div class="caps">Einfach, nachvollziehbar und ohne Datenverlust</div><h2>Monat prüfen, abschließen und als Lohnpaket herunterladen.</h2><p>Bestehende Arbeitszeiten bleiben unverändert. Die Mitarbeiterunterschrift bleibt verfügbar, ist für die Lohnvorbereitung aber freiwillig.</p></div><button class="btn light" data-payroll-action="refresh">Aktualisieren</button></div>
      ${state.error?`<div class="compliance-alert"><strong>Hinweis</strong><span>${esc(state.error)}</span></div>`:""}
      <div class="payroll-steps">${stepCard(1,"Einrichten","Personalnummern und Sollzeiten",!status.complete,status.complete)}${stepCard(2,"Prüfen","Fehler vor dem Abschluss sehen",status.complete&&!period,Boolean(preview&&!preview.blockers?.length))}${stepCard(3,"Abschließen","Unveränderbare Monatsversion",Boolean(preview&&!preview.blockers?.length&&!period),Boolean(period))}${stepCard(4,"Herunterladen","Excel, CSV, PDF und Manifest",Boolean(period&&!exportRow),Boolean(exportRow))}</div>
      <section class="payroll-simple-grid">
        <article class="dashboard-card payroll-card">
          <div class="dashboard-card-head"><div><h2>1. Grundeinstellung</h2><small>Einmal speichern, danach monatlich wiederverwenden.</small></div><span class="status-chip ${status.complete?"black":""}">${status.ready}/${status.total} Mitarbeiter bereit</span></div>
          <div class="payroll-form-grid">
            <label>Abrechnungssystem<select class="select" id="payroll-system"><option value="generic_excel" ${profile.payroll_system==="generic_excel"?"selected":""}>Excel / Steuerberater</option><option value="datev_lodas" ${profile.payroll_system==="datev_lodas"?"selected":""}>DATEV LODAS</option><option value="datev_lohn_gehalt" ${profile.payroll_system==="datev_lohn_gehalt"?"selected":""}>DATEV Lohn und Gehalt</option><option value="other" ${profile.payroll_system==="other"?"selected":""}>Anderes System</option></select></label>
            <label>Steuerberater / Kanzlei<input class="input" id="payroll-consultant-name" value="${esc(profile.consultant_name||"")}" placeholder="z. B. Kanzlei Puls"></label>
            <label>E-Mail<input class="input" id="payroll-consultant-email" type="email" value="${esc(profile.consultant_email||"")}" placeholder="lohn@kanzlei.de"></label>
            <label>Bundesland<select class="select" id="payroll-holiday-region"><option value="BE" ${profile.holiday_region==="BE"?"selected":""}>Berlin</option><option value="BB" ${profile.holiday_region==="BB"?"selected":""}>Brandenburg</option><option value="DE" ${profile.holiday_region==="DE"?"selected":""}>Deutschland / später festlegen</option></select></label>
          </div>
          <div class="payroll-note"><strong>Unterschrift bleibt erhalten.</strong><span>Arbeitszeitnachweise können weiterhin mit einer einmaligen Unterschrift bestätigt werden. Ohne Unterschrift ist die Bestätigung ebenfalls möglich.</span><button class="link-btn" data-a="admin-view" data-view="approvals">Arbeitszeitnachweise öffnen ${I.arrow}</button></div>
        </article>
        <article class="dashboard-card payroll-card payroll-month-card">
          <div class="dashboard-card-head"><div><h2>2. Monat bearbeiten</h2><small>Prüfen, erst dann abschließen.</small></div></div>
          <label class="payroll-month-label">Abrechnungsmonat<input class="input" type="month" id="payroll-month" value="${esc(state.month)}"></label>
          <div class="payroll-month-status"><span><small>Status</small><strong>${period?`Abgeschlossen · Version ${period.version}`:preview?preview.blockers?.length?"Noch nicht bereit":"Bereit zum Abschluss":"Noch nicht geprüft"}</strong></span><span><small>Letzte Prüfung</small><strong>${preview?fmtDate(preview.calculatedAt):"–"}</strong></span></div>
          <div class="payroll-actions"><button class="btn outline" data-payroll-action="preview">Monat prüfen</button><button class="btn" data-payroll-action="close" ${!preview||preview.blockers?.length||period?"disabled":""}>Monat abschließen</button><button class="btn black" data-payroll-action="export" ${period?"":"disabled"}>Lohnpaket herunterladen</button></div>
          ${period?`<div class="payroll-closed"><strong>Version ${period.version} ist gespeichert.</strong><span>Hash ${esc(String(period.snapshot_hash||"").slice(0,16))}… · ${fmtDate(period.closed_at)}</span></div>`:""}
        </article>
      </section>
      <article class="dashboard-card payroll-card payroll-wide"><div class="dashboard-card-head"><div><h2>Mitarbeiterdaten</h2><small>Personalnummer und tägliche Sollzeit. Bestehende Mitarbeiter werden nur ergänzt, nicht neu angelegt.</small></div><button class="btn" data-payroll-action="save">Einstellungen speichern</button></div>
        <div class="payroll-table-wrap"><table class="payroll-table"><thead><tr><th>Mitarbeiter</th><th>Personalnummer</th><th>Kostenstelle</th>${dayLabels.map(label=>`<th>${label}<small>Std.</small></th>`).join("")}</tr></thead><tbody>${employees.map(employee=>employeeRow(employee)).join("")||'<tr><td colspan="10">Keine Mitarbeiter vorhanden.</td></tr>'}</tbody></table></div>
        <div class="payroll-table-help">Tipp: Bei einer normalen 40-Stunden-Woche trägst du Montag bis Freitag jeweils 8 Stunden ein. Bei Teilzeit gibst du die tatsächlichen Sollstunden pro Tag ein.</div>
      </article>
      ${preview?previewSection(preview):""}
      ${["datev_lodas","datev_lohn_gehalt"].includes(profile.payroll_system)?mappingSection():""}`;
  }
  function employeeRow(employee){
    const identity=employee.payrollIdentity||{};
    return `<tr data-payroll-employee="${esc(employee.id)}"><td><strong>${esc(employee.name)}</strong><small>${esc(loc(employee.locationId)?.name||employee.role_title||employee.role||"")}</small></td><td><input class="input payroll-small" data-field="personnelNumber" value="${esc(identity.personnel_number||"")}" placeholder="z. B. 104"></td><td><input class="input payroll-small" data-field="costCenter" value="${esc(identity.cost_center||"")}" placeholder="z. B. 3014"></td>${dayKeys.map(key=>`<td><input class="input payroll-hours" type="number" min="0" max="24" step="0.25" data-day="${key}" value="${scheduleValue(employee,key)||""}" aria-label="${key}"></td>`).join("")}</tr>`;
  }
  function previewSection(preview){
    const blockers=preview.blockers||[],warnings=preview.warnings||[],employees=preview.employees||[],totals=preview.totals||{};
    return `<article class="dashboard-card payroll-card payroll-wide"><div class="dashboard-card-head"><div><h2>Prüfergebnis ${esc(preview.period?.key||state.month)}</h2><small>Nur echte Probleme blockieren den Monatsabschluss.</small></div><span class="status-chip ${blockers.length?"danger":warnings.length?"":"black"}">${blockers.length?`${blockers.length} Blocker`:warnings.length?`${warnings.length} Hinweise`:"Bereit"}</span></div>
      <div class="payroll-kpis"><div><small>Soll</small><strong>${fmtMinutes(totals.plannedMinutes)}</strong></div><div><small>Arbeitszeit</small><strong>${fmtMinutes(totals.workedMinutes)}</strong></div><div><small>Urlaub / Krankheit</small><strong>${fmtMinutes(totals.creditedMinutes)}</strong></div><div><small>Differenz</small><strong>${fmtMinutes(totals.differenceMinutes)}</strong></div></div>
      ${blockers.length||warnings.length?`<div class="payroll-issues">${[...blockers,...warnings].map(item=>`<div class="payroll-issue ${item.severity}"><b>${item.severity==="blocker"?"!":"i"}</b><span><strong>${item.severity==="blocker"?"Muss korrigiert werden":"Bitte prüfen"}</strong><small>${esc(item.message)}</small></span></div>`).join("")}</div>`:`<div class="payroll-ready">✓ Alle Pflichtangaben sind vorhanden. Der Monat kann abgeschlossen werden.</div>`}
      <div class="payroll-table-wrap"><table class="payroll-table payroll-result"><thead><tr><th>Mitarbeiter</th><th>Personalnr.</th><th>Soll</th><th>Arbeit</th><th>Abwesenheit</th><th>Differenz</th><th>Status</th></tr></thead><tbody>${employees.map(item=>`<tr><td><strong>${esc(item.name)}</strong></td><td>${esc(item.personnelNumber||"–")}</td><td>${fmtMinutes(item.plannedMinutes)}</td><td>${fmtMinutes(item.workedMinutes)}</td><td>${fmtMinutes(item.creditedMinutes)}</td><td>${fmtMinutes(item.differenceMinutes)}</td><td><span class="status-chip ${item.blockerCount?"danger":"black"}">${item.blockerCount?`${item.blockerCount} offen`:"OK"}</span></td></tr>`).join("")}</tbody></table></div></article>`;
  }
  function mappingSection(){
    return `<article class="dashboard-card payroll-card payroll-wide"><div class="dashboard-card-head"><div><h2>DATEV-Lohnarten</h2><small>Einmal mit dem Steuerberater abstimmen. Leere Felder blockieren den DATEV-Abschluss.</small></div></div><div class="payroll-mapping-grid">${["regular","night","sunday","holiday","vacation","sickness"].map(type=>{const item=mapping(type);return`<label>${esc(defaultMappings[type])}<input class="input" data-payroll-mapping="${type}" value="${esc(item.external_wage_type||"")}" placeholder="Lohnart"></label>`}).join("")}</div></article>`;
  }

  function collectSetup(){
    const employees=[...document.querySelectorAll("[data-payroll-employee]")].map(row=>{
      const hours={};for(const key of dayKeys){const value=Number(row.querySelector(`[data-day="${key}"]`)?.value||0);hours[`${key}Minutes`]=Math.max(0,Math.round(value*60))}
      return{employeeId:row.dataset.payrollEmployee,personnelNumber:row.querySelector('[data-field="personnelNumber"]')?.value||"",costCenter:row.querySelector('[data-field="costCenter"]')?.value||"",validFrom:`${state.month.slice(0,4)}-01-01`,schedule:hours};
    });
    const mappings=[...document.querySelectorAll("[data-payroll-mapping]")].map(input=>({sourceType:input.dataset.payrollMapping,externalWageType:input.value,label:defaultMappings[input.dataset.payrollMapping],unit:"hours",roundingRule:"minute",validFrom:`${state.month.slice(0,4)}-01-01`}));
    return{profile:{payrollSystem:document.getElementById("payroll-system")?.value||"generic_excel",consultantName:document.getElementById("payroll-consultant-name")?.value||"",consultantEmail:document.getElementById("payroll-consultant-email")?.value||"",holidayRegion:document.getElementById("payroll-holiday-region")?.value||"BE",cutoffDay:1},employees,mappings};
  }
  async function save(){
    state.saving=true;try{state.data=await call("saveSetup",collectSetup());state.preview=null;toast("Einstellungen wurden gespeichert. Bestehende Arbeitszeitdaten blieben unverändert.");renderAdmin()}catch(error){toast(error.message||"Einstellungen konnten nicht gespeichert werden.","error")}finally{state.saving=false}
  }
  async function preview(){
    const{year,month}=splitMonth();try{state.preview=await call("preview",{year,month});toast(state.preview.blockers?.length?"Es gibt noch Punkte, die korrigiert werden müssen.":"Der Monat wurde geprüft.",state.preview.blockers?.length?"error":"");renderAdmin()}catch(error){toast(error.message,"error")}
  }
  async function close(){
    if(!state.preview||state.preview.blockers?.length)return;
    if(!confirm(`Monat ${state.month} wirklich abschließen? Die Arbeitszeitdaten werden nicht gelöscht. Es wird nur eine unveränderbare Monatsversion gespeichert.`))return;
    const{year,month}=splitMonth();try{const result=await call("closePeriod",{year,month});toast(`Monat wurde als Version ${result.version} abgeschlossen.`);state.preview=null;await load(true)}catch(error){toast(error.message,"error")}
  }
  async function exportPackage(){
    const period=currentPeriod();if(!period)return toast("Bitte den Monat zuerst abschließen.","error");
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(`${CFG.url}/functions/v1/${FUNCTION_NAME}`,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify({action:"createExport",periodId:period.id,token:S.session?.token}),signal:controller.signal});
      if(!response.ok){let message=`HTTP ${response.status}`;try{message=(await response.json()).error||message}catch{}throw new Error(message)}
      const blob=await response.blob(),disposition=response.headers.get("content-disposition")||"";
      const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`Aora_Lohnvorbereitung_${state.month}.zip`;
      const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast(`${filename} wurde erstellt.`);await load(true);
    }catch(error){toast(error.message||"Lohnpaket konnte nicht erstellt werden.","error")}finally{clearTimeout(timeout)}
  }

  document.addEventListener("change",event=>{
    if(event.target?.id==="payroll-month"){state.month=String(event.target.value||state.month);state.preview=null;renderAdmin()}
  });
  document.addEventListener("click",async event=>{
    const button=event.target.closest("[data-payroll-action]");if(!button)return;
    const action=button.dataset.payrollAction;button.disabled=true;
    try{
      if(action==="refresh")await load(true);
      if(action==="save")await save();
      if(action==="preview")await preview();
      if(action==="close")await close();
      if(action==="export")await exportPackage();
    }finally{if(button.isConnected)button.disabled=false}
  });
})();
