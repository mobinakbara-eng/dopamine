"use strict";

const aoraComplianceState={summary:null,corrections:[],loading:false,error:"",loadedAt:0};
function addComplianceNavigation(){
  const item=["compliance","Compliance",I.chart];
  if(typeof managerNav!=="undefined"&&!managerNav.some(([id])=>id==="compliance"))managerNav.splice(Math.max(0,managerNav.length-1),0,item);
  if(typeof ownerNav!=="undefined"&&!ownerNav.some(([id])=>id==="compliance"))ownerNav.splice(Math.max(0,ownerNav.length-1),0,item);
}
addComplianceNavigation();

const aoraBaseAdminTitle=adminTitle;
adminTitle=function(){return S.adminView==="compliance"?"Compliance & Korrekturen":aoraBaseAdminTitle()};
const aoraBaseAdminView=adminView;
adminView=function(){return S.adminView==="compliance"?compliancePage():aoraBaseAdminView()};

function formatComplianceDate(value){
  if(!value)return"–";
  try{return new Date(value).toLocaleString("de-DE")}catch{return esc(value)}
}
function compliancePage(){
  queueMicrotask(()=>ensureComplianceData());
  const summary=aoraComplianceState.summary||{};
  const retention=summary.retention||{};
  const subscription=summary.subscription||{};
  const corrections=aoraComplianceState.corrections||[];
  return `<div class="compliance-header">
      <div><div class="caps">Aora Pilot Control</div><h2>Compliance, Exporte und Zeitkorrekturen</h2><p>Mandantenbezogene Nachweise, unveränderbare Zeitereignisse und freigabepflichtige Korrekturen.</p></div>
      <div class="compliance-sync"><span class="sync-dot"></span><strong>${esc(S.realtimeStatus||"fallback")}</strong><small>Workspace Sync</small></div>
    </div>
    ${aoraComplianceState.error?`<div class="compliance-alert">${esc(aoraComplianceState.error)}</div>`:""}
    <div class="admin-kpis compliance-kpis">
      ${adminKpi(I.clock,"Offene Korrekturen",summary.pendingCorrections??corrections.filter(item=>item.status==="pending").length,"Manager-Freigabe")}
      ${adminKpi(I.chart,"Fehler letzte 24h",summary.recentErrors??"–","Monitoring")}
      ${adminKpi(I.news,"Tarif",subscription.plan_code||"–",subscription.status||"Nicht hinterlegt")}
      ${adminKpi(I.cal,"Aufbewahrung",retention.time_entry_months?`${retention.time_entry_months} Monate`:"–","Arbeitszeitdaten")}
    </div>
    <div class="compliance-grid">
      <article class="dashboard-card compliance-wide">
        <div class="dashboard-card-head"><h2>Zeitkorrekturen <small>${corrections.length}</small></h2><button class="btn light" data-compliance-action="refresh">Aktualisieren</button></div>
        <div class="compliance-list">
          ${aoraComplianceState.loading&&!aoraComplianceState.loadedAt?'<div class="empty">Compliance-Daten werden geladen …</div>':corrections.map(correction=>correctionRow(correction)).join("")||'<div class="empty">Keine Korrekturanfragen vorhanden.</div>'}
        </div>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Nachweise exportieren</h2></div>
        <div class="compliance-actions">
          <button class="btn outline" data-compliance-action="export" data-format="csv">CSV Arbeitszeit</button>
          <button class="btn outline" data-compliance-action="export" data-format="pdf">PDF Prüfprotokoll</button>
          <button class="btn outline" data-compliance-action="export" data-format="audit">Audit JSON</button>
          <button class="btn outline" data-compliance-action="export" data-format="steuerberater">Steuerberater CSV</button>
        </div>
        <p class="small muted">Jeder Export erhält einen serverseitigen SHA-256-Prüfwert und wird protokolliert.</p>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Backup & Retention</h2></div>
        <dl class="compliance-details">
          <div><dt>Letztes Backup</dt><dd>${formatComplianceDate(summary.lastBackup?.created_at)}</dd></div>
          <div><dt>Verifiziert</dt><dd>${summary.lastBackup?.verified_at?"Ja":"–"}</dd></div>
          <div><dt>Audit</dt><dd>${retention.audit_months?`${retention.audit_months} Monate`:"–"}</dd></div>
          <div><dt>Dateien</dt><dd>${retention.file_months?`${retention.file_months} Monate`:"–"}</dd></div>
        </dl>
        ${isOwner()?'<button class="btn" data-compliance-action="backup">Verifiziertes Snapshot erstellen</button>':'<p class="small muted">Backups können nur vom Inhaber erstellt werden.</p>'}
      </article>
    </div>`;
}
function correctionRow(correction){
  const proposed=correction.proposed_value||{};
  const proposedText=[proposed.date,proposed.start&&proposed.end?`${proposed.start}–${proposed.end}`:null,proposed.breakMinutes!==undefined?`Pause ${proposed.breakMinutes} Min.`:null].filter(Boolean).join(" · ")||"Keine Feldänderung";
  const pending=correction.status==="pending";
  return `<div class="compliance-row">
    <div><strong>${esc(correction.employee_id||"Mitarbeiter")}</strong><small>${esc(proposedText)} · ${formatComplianceDate(correction.requested_at)}</small><p>${esc(correction.reason||"")}</p></div>
    <span class="status-chip ${correction.status==="approved"?"black":""}">${correction.status==="approved"?"Genehmigt":correction.status==="rejected"?"Abgelehnt":"Offen"}</span>
    ${pending?`<div class="compliance-decision"><button class="btn light" data-compliance-action="decide" data-decision="rejected" data-id="${esc(correction.id)}">Ablehnen</button><button class="btn" data-compliance-action="decide" data-decision="approved" data-id="${esc(correction.id)}">Genehmigen</button></div>`:""}
  </div>`;
}
async function ensureComplianceData(force=false){
  if(aoraComplianceState.loading)return;
  if(!force&&aoraComplianceState.loadedAt&&Date.now()-aoraComplianceState.loadedAt<30000)return;
  aoraComplianceState.loading=true;aoraComplianceState.error="";
  try{
    const [summary,result]=await Promise.all([compliance({action:"summary"}),compliance({action:"listCorrections"})]);
    aoraComplianceState.summary=summary;
    aoraComplianceState.corrections=result.corrections||[];
    aoraComplianceState.loadedAt=Date.now();
  }catch(error){aoraComplianceState.error=error.message||"Compliance-Daten konnten nicht geladen werden."}
  finally{
    aoraComplianceState.loading=false;
    if(S.adminView==="compliance"&&S.session)renderAdmin();
  }
}
function employeeCorrectionEntries(){
  const subject=String(S.session?.subjectId||S.session?.employeeId||"");
  return(S.state?.timeEntries||[]).filter(entry=>String(entry.employeeId)===subject);
}
function ensureComplianceDialog(){
  let dialog=document.getElementById("aora-compliance-dialog");
  if(dialog)return dialog;
  dialog=document.createElement("dialog");dialog.id="aora-compliance-dialog";dialog.className="aora-compliance-dialog";
  document.body.appendChild(dialog);return dialog;
}
function openCorrectionDialog(){
  const entries=employeeCorrectionEntries();
  if(!entries.length)return toast("Für dein Konto gibt es noch keinen korrigierbaren Zeiteintrag.","warning");
  const dialog=ensureComplianceDialog();
  dialog.innerHTML=`<form id="aora-correction-form" method="dialog">
    <div class="dialog-head"><div><div class="caps">Zeitnachweis</div><h2>Korrektur beantragen</h2></div><button type="button" class="circle-btn" data-compliance-action="close">${I.x}</button></div>
    <div class="field"><label>Zeiteintrag</label><select class="select" name="timeEntryId" required>${entries.map(entry=>`<option value="${esc(entry.id)}">${esc(entry.date||"")} · ${esc(entry.start||"")}–${esc(entry.end||"offen")}</option>`).join("")}</select></div>
    <div class="correction-fields"><div class="field"><label>Datum</label><input class="input" type="date" name="date"></div><div class="field"><label>Start</label><input class="input" type="time" name="start"></div><div class="field"><label>Ende</label><input class="input" type="time" name="end"></div><div class="field"><label>Pause (Min.)</label><input class="input" type="number" min="0" max="240" name="breakMinutes"></div></div>
    <div class="field"><label>Begründung</label><textarea class="input" name="reason" minlength="5" required placeholder="Was soll korrigiert werden und warum?"></textarea></div>
    <div class="dialog-actions"><button type="button" class="btn light" data-compliance-action="close">Abbrechen</button><button class="btn" type="submit">Anfrage senden</button></div>
  </form>`;
  dialog.showModal();
}
const aoraBaseRenderEmployee=renderEmployee;
renderEmployee=function(){
  aoraBaseRenderEmployee();
  if(!document.querySelector("[data-compliance-action='request-correction']")){
    const button=document.createElement("button");button.className="btn employee-correction-fab";button.dataset.complianceAction="request-correction";button.textContent="Zeitkorrektur";app.appendChild(button);
  }
};

document.addEventListener("click",async event=>{
  const button=event.target.closest("[data-compliance-action]");if(!button)return;
  const action=button.dataset.complianceAction;
  if(action==="request-correction")return openCorrectionDialog();
  if(action==="close")return button.closest("dialog")?.close();
  if(action==="refresh"){await ensureComplianceData(true);return}
  if(action==="export"){
    button.disabled=true;
    try{const result=await downloadCompliance(button.dataset.format);toast(`${result.filename} wurde erstellt.`)}catch(error){toast(error.message,"error")}finally{button.disabled=false}
    return;
  }
  if(action==="backup"){
    button.disabled=true;
    try{const result=await compliance({action:"backup"});toast(result.verified?"Backup wurde erstellt und verifiziert.":"Backup konnte nicht verifiziert werden.",result.verified?"success":"error");await ensureComplianceData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}
    return;
  }
  if(action==="decide"){
    const decision=button.dataset.decision;
    const decisionReason=decision==="rejected"?prompt("Begründung für die Ablehnung (mindestens 5 Zeichen):",""):prompt("Optionale Entscheidungsnotiz:","");
    if(decision==="rejected"&&String(decisionReason||"").trim().length<5)return toast("Bei Ablehnung ist eine Begründung erforderlich.","error");
    button.disabled=true;
    try{await compliance({action:"decideCorrection",correctionId:button.dataset.id,decision,decisionReason:String(decisionReason||"").trim()});toast(decision==="approved"?"Korrektur wurde genehmigt.":"Korrektur wurde abgelehnt.");await loadState(true);await ensureComplianceData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}
  }
});
document.addEventListener("submit",async event=>{
  if(event.target.id!=="aora-correction-form")return;
  event.preventDefault();
  const form=new FormData(event.target);
  const proposedValue={};
  for(const key of ["date","start","end"]){const value=String(form.get(key)||"").trim();if(value)proposedValue[key]=value}
  const pause=String(form.get("breakMinutes")||"").trim();if(pause)proposedValue.breakMinutes=Number(pause);
  const submit=event.target.querySelector("button[type='submit']");submit.disabled=true;
  try{
    await compliance({action:"requestCorrection",timeEntryId:String(form.get("timeEntryId")||""),reason:String(form.get("reason")||"").trim(),proposedValue});
    event.target.closest("dialog")?.close();toast("Korrekturanfrage wurde an den Manager gesendet.");
  }catch(error){toast(error.message,"error")}finally{submit.disabled=false}
});
