"use strict";

(function installTimesheetApproval(){
  const FUNCTION_NAME="aora-v8-timesheet-approval";
  const managerState={data:null,loading:false,error:"",loadedAt:0,employeeId:"",dateFrom:"",dateTo:""};
  const employeeState={data:null,loading:false,error:"",loadedAt:0};

  function today(){return typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10)}
  function monthRange(value=today()){
    const [year,month]=String(value).split("-").map(Number);
    const from=`${year}-${String(month).padStart(2,"0")}-01`;
    const to=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
    return{from,to};
  }
  Object.assign(managerState,{dateFrom:monthRange().from,dateTo:monthRange().to});
  function formatDate(value){if(!value)return"–";try{return new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString("de-DE",{timeZone:"UTC"})}catch{return esc(value)}}
  function formatDateTime(value){if(!value)return"–";try{return new Date(value).toLocaleString("de-DE")}catch{return esc(value)}}
  function formatMinutes(value){const minutes=Math.round(Number(value)||0);const sign=minutes<0?"-":"";const abs=Math.abs(minutes);return`${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`}
  function statusText(status,decision){
    if(status==="locked")return"Exportiert";
    if(status==="approved")return"Freigegeben";
    if(status==="submitted")return"Wartet auf Mitarbeiter";
    if(decision==="declined")return"Abgelehnt";
    return"Entwurf";
  }
  function statusClass(status,decision){return status==="approved"||status==="locked"?"black":decision==="declined"?"danger":""}
  function call(action,payload={}){return request(FUNCTION_NAME,{action,token:S.session?.token,...payload})}
  async function download(submissionId,format){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS||20000);
    try{
      const response=await fetch(`${CFG.url}/functions/v1/${FUNCTION_NAME}`,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=UTF-8"},
        body:JSON.stringify({action:"exportTimesheet",submissionId,format,token:S.session?.token}),
        signal:controller.signal
      });
      if(!response.ok){
        let message=`HTTP ${response.status}`;
        try{const data=await response.json();message=data.error||message}catch{}
        throw Object.assign(new Error(message),{status:response.status});
      }
      const blob=await response.blob();
      const disposition=response.headers.get("content-disposition")||"";
      const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`Arbeitszeitnachweis.${format}`;
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.hidden=true;
      document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      return{filename,checksum:response.headers.get("x-document-checksum")};
    }finally{clearTimeout(timeout)}
  }

  function addManagerNavigation(){
    const item=["approvals","Freigaben",I.news];
    if(typeof managerNav!=="undefined"&&!managerNav.some(([id])=>id==="approvals")){
      const reportsIndex=managerNav.findIndex(([id])=>id==="reports");
      managerNav.splice(reportsIndex<0?managerNav.length:reportsIndex,0,item);
    }
    if(typeof ownerNav!=="undefined"&&!ownerNav.some(([id])=>id==="approvals")){
      const reportsIndex=ownerNav.findIndex(([id])=>id==="reports");
      ownerNav.splice(reportsIndex<0?ownerNav.length:reportsIndex,0,item);
    }
  }
  addManagerNavigation();

  const baseAdminTitle=adminTitle;
  adminTitle=function(){return S.adminView==="approvals"?"Freigaben & Nachweise":baseAdminTitle()};
  const baseAdminView=adminView;
  adminView=function(){return S.adminView==="approvals"?managerPage():baseAdminView()};

  async function ensureManagerData(force=false){
    if(managerState.loading)return;
    if(!force&&managerState.loadedAt&&Date.now()-managerState.loadedAt<20000)return;
    managerState.loading=true;managerState.error="";
    try{
      managerState.data=await call("managerOverview");
      const employees=managerState.data.employees||[];
      if(!managerState.employeeId||!employees.some(item=>String(item.id)===managerState.employeeId))managerState.employeeId=String(employees[0]?.id||"");
      managerState.loadedAt=Date.now();
    }catch(error){managerState.error=error.message||"Freigaben konnten nicht geladen werden."}
    finally{
      managerState.loading=false;
      if(S.adminView==="approvals"&&S.session)renderAdmin();
    }
  }
  function selectedEmployee(){return(managerState.data?.employees||[]).find(item=>String(item.id)===managerState.employeeId)}
  function latestByEmployee(rows=[]){
    const map=new Map();
    for(const row of rows)if(!map.has(String(row.employee_id)))map.set(String(row.employee_id),row);
    return map;
  }
  function managerPage(){
    queueMicrotask(()=>ensureManagerData());
    const data=managerState.data||{};
    const employees=data.employees||[];
    const requests=latestByEmployee(data.requests||[]);
    const signatures=latestByEmployee((data.signatures||[]).filter(item=>item.active&&!item.revoked_at));
    const submissions=data.submissions||[];
    const employee=selectedEmployee();
    const selectedRequest=requests.get(managerState.employeeId);
    const selectedSignature=signatures.get(managerState.employeeId);
    const selectedSubmissions=submissions.filter(item=>String(item.employee_id)===managerState.employeeId);
    return `<div class="timesheet-hero">
      <div><div class="caps">Dokumentierter Freigabeprozess</div><h2>Einwilligungen und Arbeitszeitnachweise</h2><p>Erst Erklärung und Unterschrift, dann ein konkreter Nachweis, danach der freigegebene Export für die Lohnabrechnung.</p></div>
      <button class="btn light" data-timesheet-action="refresh-manager">Aktualisieren</button>
    </div>
    ${managerState.error?`<div class="compliance-alert">${esc(managerState.error)}</div>`:""}
    <div class="timesheet-step-grid">
      <article><b>1</b><span><strong>Erklärungen senden</strong><small>Versionierte Texte und freiwillige Signatur-Einwilligung.</small></span></article>
      <article><b>2</b><span><strong>Nachweis prüfen lassen</strong><small>Der Mitarbeiter sieht exakt die gespeicherten Daten.</small></span></article>
      <article><b>3</b><span><strong>Freigegeben exportieren</strong><small>PDF und Excel entstehen aus demselben unveränderbaren Snapshot.</small></span></article>
    </div>
    <div class="timesheet-manager-grid">
      <article class="dashboard-card timesheet-control-card">
        <div class="dashboard-card-head"><h2>Neuen Vorgang starten</h2></div>
        <div class="timesheet-form-grid">
          <label>Mitarbeiter/in<select class="select" id="timesheet-employee-select">${employees.map(item=>`<option value="${esc(item.id)}" ${String(item.id)===managerState.employeeId?"selected":""}>${esc(item.name)} · ${esc(loc(item.locationId||item.primaryLocationId)?.name||"")}</option>`).join("")}</select></label>
          <label>Von<input class="input" type="date" id="timesheet-date-from" value="${esc(managerState.dateFrom)}"></label>
          <label>Bis<input class="input" type="date" id="timesheet-date-to" value="${esc(managerState.dateTo)}"></label>
        </div>
        ${employee?`<div class="timesheet-readiness">
          <span class="status-chip ${selectedRequest?.status==="accepted"?"black":""}">${selectedRequest?.status==="accepted"?"Erklärungen bestätigt":selectedRequest?.status==="pending"?"Erklärungen offen":"Erklärungen fehlen"}</span>
          <span class="status-chip ${selectedSignature?"black":""}">${selectedSignature?"Unterschrift aktiv":"Keine Unterschrift"}</span>
        </div>
        <div class="timesheet-actions">
          <button class="btn outline" data-timesheet-action="send-consent" data-employee-id="${esc(employee.id)}">Erklärungen anfordern</button>
          <button class="btn" data-timesheet-action="send-timesheet" data-employee-id="${esc(employee.id)}" ${selectedRequest?.status!=="accepted"||!selectedSignature?"disabled":""}>Arbeitszeitnachweis senden</button>
        </div>`:'<div class="empty">Keine Mitarbeiter vorhanden.</div>'}
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Status der Mitarbeiter <small>${employees.length}</small></h2></div>
        <div class="timesheet-employee-list">${employees.map(item=>{
          const requestRow=requests.get(String(item.id));
          const signatureRow=signatures.get(String(item.id));
          return`<button data-timesheet-action="select-employee" data-employee-id="${esc(item.id)}" class="timesheet-employee-row ${String(item.id)===managerState.employeeId?"active":""}">
            <span class="avatar">${esc(item.initials||initials(item.name))}</span><span><strong>${esc(item.name)}</strong><small>${esc(loc(item.locationId||item.primaryLocationId)?.name||"Standort offen")}</small></span>
            <em>${requestRow?.status==="accepted"&&signatureRow?"Bereit":requestRow?.status==="pending"?"Antwort offen":"Einrichtung fehlt"}</em>
          </button>`
        }).join("")||'<div class="empty">Keine Mitarbeiter.</div>'}</div>
      </article>
    </div>
    <article class="dashboard-card timesheet-wide-card">
      <div class="dashboard-card-head"><h2>Nachweise ${employee?`für ${esc(employee.name)}`:""} <small>${selectedSubmissions.length}</small></h2></div>
      <div class="timesheet-submission-list">${selectedSubmissions.map(submission=>submissionRow(submission,true)).join("")||'<div class="empty">Für diese Person wurde noch kein Nachweis versendet.</div>'}</div>
    </article>`;
  }
  function submissionRow(submission,manager=false){
    const snapshot=submission.payload?.snapshot||{};
    const totals=snapshot.totals||{};
    const canExport=["approved","locked"].includes(submission.status);
    return `<div class="timesheet-submission-row">
      <div><strong>${formatDate(submission.date_from)} – ${formatDate(submission.date_to)}</strong><small>Version ${submission.version||1} · ${formatMinutes(totals.totalMinutes)} Gesamt · ${snapshot.location?.name?esc(snapshot.location.name):"Standort"}</small>${submission.employee_note?`<p>${esc(submission.employee_note)}</p>`:""}</div>
      <span class="status-chip ${statusClass(submission.status,submission.employee_decision)}">${statusText(submission.status,submission.employee_decision)}</span>
      <div class="timesheet-row-actions">
        <button class="btn light" data-timesheet-action="view-submission" data-submission-id="${esc(submission.id)}" data-mode="${manager?"manager":"employee"}">Ansehen</button>
        ${manager&&canExport?`<button class="btn outline" data-timesheet-action="export" data-format="pdf" data-submission-id="${esc(submission.id)}">PDF</button><button class="btn" data-timesheet-action="export" data-format="xlsx" data-submission-id="${esc(submission.id)}">Excel</button>`:""}
      </div>
    </div>`;
  }

  const baseEmployeeView=employeeView;
  employeeView=function(employee,view){
    if(view==="documents")return employeeDocumentsPage(employee);
    const html=baseEmployeeView(employee,view);
    if(view!=="more")return html;
    return `${html}<article class="timesheet-employee-entry"><div><div class="caps muted">Dokumente</div><h2>Freigaben & Nachweise</h2><p>Erklärungen lesen, Unterschrift verwalten und Arbeitszeitnachweise prüfen.</p></div><button class="btn" data-timesheet-action="open-employee-documents">Öffnen</button></article>`;
  };
  async function ensureEmployeeData(force=false){
    if(employeeState.loading)return;
    if(!force&&employeeState.loadedAt&&Date.now()-employeeState.loadedAt<15000)return;
    employeeState.loading=true;employeeState.error="";
    try{employeeState.data=await call("employeeInbox");employeeState.loadedAt=Date.now()}
    catch(error){employeeState.error=error.message||"Dokumente konnten nicht geladen werden."}
    finally{employeeState.loading=false;if(S.employeeView==="documents"&&S.session)renderEmployee()}
  }
  function employeeDocumentsPage(employee){
    queueMicrotask(()=>ensureEmployeeData());
    const data=employeeState.data||{};
    const requests=data.requests||[];
    const pending=requests.find(item=>item.status==="pending");
    const activeSignature=(data.signatures||[]).find(item=>item.active&&!item.revoked_at);
    const submissions=data.submissions||[];
    return `<div class="employee-page-title"><div><div class="caps muted">Persönliche Dokumente</div><h1>Freigaben & Nachweise</h1></div><button class="btn light" data-timesheet-action="close-employee-documents">Zurück</button></div>
      ${employeeState.error?`<div class="compliance-alert">${esc(employeeState.error)}</div>`:""}
      <article class="timesheet-mobile-card">
        <div class="timesheet-mobile-card-head"><div><div class="caps">Unterschrift</div><h2>${activeSignature?"Aktiv hinterlegt":"Noch nicht eingerichtet"}</h2></div><span class="status-chip ${activeSignature?"black":""}">${activeSignature?"Aktiv":"Fehlt"}</span></div>
        <p>Eine gespeicherte Unterschrift wird niemals automatisch verwendet. Sie erscheint erst, nachdem du einen konkreten Nachweis persönlich freigegeben hast.</p>
        ${activeSignature?`<button class="btn light" data-timesheet-action="revoke-signature">Einwilligung für die Zukunft widerrufen</button>`:""}
      </article>
      ${pending?`<article class="timesheet-mobile-card urgent"><div class="caps">Aktion erforderlich</div><h2>Erklärungen lesen und bestätigen</h2><p>Dein Arbeitgeber hat dir am ${formatDateTime(pending.requested_at)} drei getrennte Erklärungen gesendet.</p><div class="timesheet-actions"><button class="btn light" data-timesheet-action="decline-consent" data-request-id="${esc(pending.id)}">Ablehnen</button><button class="btn" data-timesheet-action="open-consent" data-request-id="${esc(pending.id)}">Lesen & unterschreiben</button></div></article>`:""}
      <article class="timesheet-mobile-card"><div class="timesheet-mobile-card-head"><div><div class="caps">Arbeitszeit</div><h2>Deine Nachweise</h2></div><button class="circle-btn" data-timesheet-action="refresh-employee" aria-label="Aktualisieren">↻</button></div><div class="timesheet-submission-list">${submissions.map(item=>submissionRow(item,false)).join("")||'<div class="empty">Noch kein Nachweis vorhanden.</div>'}</div></article>`;
  }

  function dialogRoot(){
    let dialog=document.getElementById("timesheet-dialog");
    if(!dialog){dialog=document.createElement("dialog");dialog.id="timesheet-dialog";dialog.className="timesheet-dialog";document.body.appendChild(dialog)}
    return dialog;
  }
  function closeDialog(){dialogRoot().close()}
  function openConsentDialog(requestId){
    const requestRow=(employeeState.data?.requests||[]).find(item=>String(item.id)===String(requestId));
    const statements=requestRow?.payload?.statements||employeeState.data?.statements||[];
    const hasActive=(employeeState.data?.signatures||[]).some(item=>item.active&&!item.revoked_at);
    const dialog=dialogRoot();
    dialog.innerHTML=`<form id="timesheet-consent-form" method="dialog" data-request-id="${esc(requestId)}">
      <div class="dialog-head"><div><div class="caps">Version ${esc(requestRow?.document_version||employeeState.data?.version||"")}</div><h2>Erklärungen und Unterschrift</h2></div><button type="button" class="circle-btn" data-timesheet-action="close-dialog">${I.x}</button></div>
      <p class="timesheet-legal-intro">Bitte lies jede Erklärung vollständig. Die freiwillige Einwilligung zur Speicherung der Unterschrift kann später mit Wirkung für die Zukunft widerrufen werden.</p>
      <div class="timesheet-statement-list">${statements.map(statement=>`<label class="timesheet-statement"><span><strong>${esc(statement.title)}</strong><small>${statement.type==="consent"?"Freiwillige Einwilligung":statement.type==="authorization"?"Dokumentbezogene Autorisierung":"Kenntnisnahme"}</small><p>${esc(statement.text)}</p></span><input type="checkbox" name="${esc(statement.key)}" required><b>Bestätigen</b></label>`).join("")}</div>
      <div class="timesheet-signature-box">
        <div><strong>${hasActive?"Neue Unterschrift (optional)":"Unterschrift zeichnen"}</strong><small>${hasActive?"Ohne neue Zeichnung wird deine aktive Unterschrift weiterverwendet.":"Mit Finger, Maus oder Stift im Feld unterschreiben."}</small></div>
        <canvas id="timesheet-signature-canvas" width="760" height="220" aria-label="Unterschriftsfeld"></canvas>
        <button type="button" class="btn light" data-timesheet-action="clear-signature">Feld leeren</button>
      </div>
      <div class="dialog-actions"><button type="button" class="btn light" data-timesheet-action="close-dialog">Abbrechen</button><button type="submit" class="btn">Verbindlich bestätigen</button></div>
    </form>`;
    dialog.showModal();setupSignatureCanvas();
  }
  function setupSignatureCanvas(){
    const canvas=document.getElementById("timesheet-signature-canvas");if(!canvas)return;
    const context=canvas.getContext("2d");context.lineWidth=4;context.lineCap="round";context.lineJoin="round";context.strokeStyle="#151515";
    canvas.dataset.dirty="false";let drawing=false;
    const point=event=>{const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height}};
    canvas.addEventListener("pointerdown",event=>{drawing=true;canvas.setPointerCapture(event.pointerId);const p=point(event);context.beginPath();context.moveTo(p.x,p.y);event.preventDefault()});
    canvas.addEventListener("pointermove",event=>{if(!drawing)return;const p=point(event);context.lineTo(p.x,p.y);context.stroke();canvas.dataset.dirty="true";event.preventDefault()});
    const stop=()=>{drawing=false};canvas.addEventListener("pointerup",stop);canvas.addEventListener("pointercancel",stop);canvas.addEventListener("pointerleave",stop);
  }
  function openSubmissionDialog(submission,mode){
    const snapshot=submission?.payload?.snapshot||{};
    const rows=snapshot.rows||[];
    const canDecide=mode==="employee"&&submission.status==="submitted";
    const dialog=dialogRoot();
    dialog.innerHTML=`<div class="dialog-head"><div><div class="caps">Arbeitszeitnachweis</div><h2>${esc(snapshot.employee?.name||"Mitarbeiter/in")}</h2><p>${formatDate(snapshot.period?.from)} – ${formatDate(snapshot.period?.to)} · ${esc(snapshot.location?.name||"")}</p></div><button type="button" class="circle-btn" data-timesheet-action="close-dialog">${I.x}</button></div>
      <div class="timesheet-document-meta"><span><small>Standort</small><strong>${esc(snapshot.location?.name||"–")}</strong><em>${esc([snapshot.location?.address,snapshot.location?.postalCode,snapshot.location?.city].filter(Boolean).join(", "))}</em></span><span><small>Gesamt</small><strong>${formatMinutes(snapshot.totals?.totalMinutes)}</strong><em>Differenz ${formatMinutes(snapshot.totals?.differenceMinutes)}</em></span></div>
      <div class="timesheet-document-table"><table><thead><tr><th>Datum</th><th>Art</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Netto</th><th>Bemerkung</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${formatDate(row.date)}</td><td>${esc(row.type)}</td><td>${esc(row.start||"–")}</td><td>${esc(row.end||"–")}</td><td>${Number(row.breakMinutes)||0} Min.</td><td><strong>${formatMinutes(row.netMinutes)}</strong></td><td>${esc(row.note||"")}</td></tr>`).join("")}</tbody></table></div>
      <div class="timesheet-hash-note"><strong>Integritätsnachweis</strong><code>${esc(submission.snapshot_hash||"")}</code><p>Deine Freigabe bezieht sich exakt auf diesen gespeicherten Inhalt.</p></div>
      ${canDecide?`<div class="timesheet-decision-box"><label>Notiz oder Korrekturhinweis<textarea class="input" id="timesheet-decision-note" placeholder="Optional bei Freigabe, erforderlich bei Ablehnung"></textarea></label><div class="dialog-actions"><button class="btn light" data-timesheet-action="decide-timesheet" data-decision="declined" data-submission-id="${esc(submission.id)}">Korrektur anfordern</button><button class="btn" data-timesheet-action="decide-timesheet" data-decision="approved" data-submission-id="${esc(submission.id)}">Nachweis freigeben</button></div></div>`:`<div class="dialog-actions"><button class="btn" data-timesheet-action="close-dialog">Schließen</button></div>`}`;
    dialog.showModal();
  }

  function reportLocation(){
    const employeeId=String(S.reportFilters?.employeeId||"");
    const employee=(S.state?.employees||[]).find(item=>String(item.id)===employeeId);
    const locationId=employee?.locationId||employee?.primaryLocationId||S.locationId;
    return loc(locationId)||{};
  }
  function unbrandReport(html){
    const location=reportLocation();
    const company=esc(S.state?.company?.name||"Arbeitgeber");
    const locationName=esc(location.name||"Standort gemäß Nachweis");
    const address=esc([location.address,location.postalCode||location.zip,location.city].filter(Boolean).join(", "));
    const employer=`<div class="aora-report-employer"><strong>${company}</strong><span>${locationName}</span>${address?`<small>${address}</small>`:""}</div>`;
    return String(html)
      .replace(/<div class="aora-report-brand">[\s\S]*?<\/div>/g,employer)
      .replace(/<div class="aora-report-preview-label">[\s\S]*?<\/div>/g,'<div class="aora-report-preview-label"><span>A4</span> Arbeitgeberdokument</div>')
      .replace(/<div class="aora-report-page-footer">[\s\S]*?<\/div>/g,`<div class="aora-report-page-footer"><span>${company}</span><span>${locationName}${address?` · ${address}`:""}</span></div>`)
      .replace(/AoraAI Workforce/g,company)
      .replace(/Aora Zeiterfassungssystem/g,"Arbeitszeitnachweis")
      .replace(/Aora Arbeitszeitnachweis/g,"Arbeitszeitnachweis");
  }
  if(typeof reportsPage==="function"){
    const baseReportsPage=reportsPage;
    reportsPage=function(...args){return unbrandReport(baseReportsPage(...args))};
  }

  document.addEventListener("change",event=>{
    if(event.target.id==="timesheet-employee-select"){managerState.employeeId=String(event.target.value||"");renderAdmin()}
    if(event.target.id==="timesheet-date-from")managerState.dateFrom=String(event.target.value||"");
    if(event.target.id==="timesheet-date-to")managerState.dateTo=String(event.target.value||"");
  });
  document.addEventListener("click",async event=>{
    const button=event.target.closest("[data-timesheet-action]");if(!button)return;
    const action=button.dataset.timesheetAction;
    if(action==="close-dialog")return closeDialog();
    if(action==="open-employee-documents"){S.employeeView="documents";renderEmployee();return}
    if(action==="close-employee-documents"){S.employeeView="more";renderEmployee();return}
    if(action==="refresh-manager"){await ensureManagerData(true);return}
    if(action==="refresh-employee"){await ensureEmployeeData(true);return}
    if(action==="select-employee"){managerState.employeeId=String(button.dataset.employeeId||"");renderAdmin();return}
    if(action==="open-consent")return openConsentDialog(button.dataset.requestId);
    if(action==="clear-signature"){
      const canvas=document.getElementById("timesheet-signature-canvas");if(canvas){canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);canvas.dataset.dirty="false"}return;
    }
    if(action==="view-submission"){
      const rows=button.dataset.mode==="manager"?(managerState.data?.submissions||[]):(employeeState.data?.submissions||[]);
      const submission=rows.find(item=>String(item.id)===String(button.dataset.submissionId));if(submission)openSubmissionDialog(submission,button.dataset.mode);return;
    }
    if(action==="send-consent"){
      button.disabled=true;try{await call("sendConsentRequest",{employeeId:button.dataset.employeeId});toast("Die Erklärungen wurden an den Mitarbeiter gesendet.");await ensureManagerData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="send-timesheet"){
      if(!managerState.dateFrom||!managerState.dateTo)return toast("Bitte einen vollständigen Zeitraum auswählen.","error");
      button.disabled=true;try{await call("sendTimesheet",{employeeId:button.dataset.employeeId,dateFrom:managerState.dateFrom,dateTo:managerState.dateTo});toast("Der Arbeitszeitnachweis wurde zur Prüfung gesendet.");await ensureManagerData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="decline-consent"){
      const note=prompt("Optionale Begründung:","");button.disabled=true;
      try{await call("declineConsentRequest",{requestId:button.dataset.requestId,note:String(note||"")});toast("Die Anfrage wurde abgelehnt.");await ensureEmployeeData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="revoke-signature"){
      if(!confirm("Möchtest du die Einwilligung zur zukünftigen Verwendung deiner Unterschrift wirklich widerrufen? Bereits freigegebene Nachweise bleiben unverändert."))return;
      button.disabled=true;try{await call("revokeSignatureConsent");toast("Die Einwilligung wurde für die Zukunft widerrufen.");await ensureEmployeeData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="decide-timesheet"){
      const decision=button.dataset.decision;const note=String(document.getElementById("timesheet-decision-note")?.value||"").trim();
      if(decision==="declined"&&note.length<5)return toast("Bitte beschreibe die gewünschte Korrektur.","error");
      button.disabled=true;try{await call("decideTimesheet",{submissionId:button.dataset.submissionId,decision,note});closeDialog();toast(decision==="approved"?"Der Nachweis wurde freigegeben.":"Die Korrekturanfrage wurde gesendet.");await ensureEmployeeData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="export"){
      button.disabled=true;try{const result=await download(button.dataset.submissionId,button.dataset.format);toast(`${result.filename} wurde erstellt.`);await ensureManagerData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}
    }
  });
  document.addEventListener("submit",async event=>{
    if(event.target.id!=="timesheet-consent-form")return;
    event.preventDefault();
    const form=event.target;const submit=form.querySelector("button[type='submit']");
    const data=new FormData(form);const statements=form.querySelectorAll('.timesheet-statement input[type="checkbox"]');
    const decisions={};for(const input of statements)decisions[input.name]=input.checked;
    const canvas=document.getElementById("timesheet-signature-canvas");
    const signatureDataUrl=canvas?.dataset.dirty==="true"?canvas.toDataURL("image/png"):null;
    const hasActive=(employeeState.data?.signatures||[]).some(item=>item.active&&!item.revoked_at);
    if(!signatureDataUrl&&!hasActive)return toast("Bitte unterschreibe im Feld.","error");
    submit.disabled=true;
    try{await call("acceptConsentRequest",{requestId:form.dataset.requestId,decisions,signatureDataUrl});closeDialog();toast("Erklärungen und Unterschrift wurden sicher gespeichert.");await ensureEmployeeData(true)}catch(error){toast(error.message,"error")}finally{submit.disabled=false}
  });
})();
