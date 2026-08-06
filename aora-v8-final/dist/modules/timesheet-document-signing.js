"use strict";

(function installDocumentScopedTimesheetSigning(){
  const FUNCTION_NAME="aora-v8-timesheet-document-signing";
  const managerState={data:null,loading:false,error:"",loadedAt:0,employeeId:"",dateFrom:"",dateTo:""};
  const employeeState={data:null,loading:false,error:"",loadedAt:0};

  function today(){return typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10)}
  function monthRange(value=today()){
    const [year,month]=String(value).split("-").map(Number);
    return{from:`${year}-${String(month).padStart(2,"0")}-01`,to:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)};
  }
  Object.assign(managerState,{dateFrom:monthRange().from,dateTo:monthRange().to});
  function formatDate(value){if(!value)return"–";try{return new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString("de-DE",{timeZone:"UTC"})}catch{return esc(value)}}
  function formatDateTime(value){if(!value)return"–";try{return new Date(value).toLocaleString("de-DE")}catch{return esc(value)}}
  function formatMinutes(value){const minutes=Math.round(Number(value)||0),sign=minutes<0?"-":"",abs=Math.abs(minutes);return`${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`}
  function statusText(submission){
    if(submission.status==="locked")return"Bestätigt & exportiert";
    if(submission.status==="approved")return"Bestätigt & unterschrieben";
    if(submission.status==="submitted")return"Wartet auf Mitarbeiter";
    if(submission.employee_decision==="declined")return"Korrektur angefordert";
    return"Entwurf";
  }
  function statusClass(submission){return["approved","locked"].includes(submission.status)?"black":submission.employee_decision==="declined"?"danger":""}
  function call(action,payload={}){return request(FUNCTION_NAME,{action,token:S.session?.token,...payload})}
  async function download(submissionId,format,signed){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(`${CFG.url}/functions/v1/${FUNCTION_NAME}`,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=UTF-8"},
        body:JSON.stringify({action:"exportTimesheet",submissionId,format,signed:Boolean(signed),token:S.session?.token}),
        signal:controller.signal
      });
      if(!response.ok){let message=`HTTP ${response.status}`;try{message=(await response.json()).error||message}catch{}throw Object.assign(new Error(message),{status:response.status})}
      const blob=await response.blob();
      const disposition=response.headers.get("content-disposition")||"";
      const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`Arbeitszeitnachweis_${signed?"Bestaetigt":"Ohne_Unterschrift"}.${format}`;
      const url=URL.createObjectURL(blob),anchor=document.createElement("a");
      anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      return{filename,checksum:response.headers.get("x-document-checksum"),signed:response.headers.get("x-document-signed")==="true"};
    }finally{clearTimeout(timeout)}
  }
  function selectedEmployee(){return(managerState.data?.employees||[]).find(item=>String(item.id)===managerState.employeeId)}
  function employeeSubmissions(){return(managerState.data?.submissions||[]).filter(item=>String(item.employee_id)===managerState.employeeId)}
  function currentPeriodSubmission(){return employeeSubmissions().find(item=>String(item.date_from)===managerState.dateFrom&&String(item.date_to)===managerState.dateTo)}

  const previousAdminTitle=adminTitle;
  adminTitle=function(){return S.adminView==="approvals"?"Arbeitszeitnachweise":previousAdminTitle()};
  const previousAdminView=adminView;
  adminView=function(){return S.adminView==="approvals"?managerPage():previousAdminView()};

  async function ensureManagerData(force=false){
    if(managerState.loading)return;
    if(!force&&managerState.loadedAt&&Date.now()-managerState.loadedAt<15000)return;
    managerState.loading=true;managerState.error="";
    try{
      managerState.data=await call("managerOverview");
      const employees=managerState.data.employees||[];
      if(!managerState.employeeId||!employees.some(item=>String(item.id)===managerState.employeeId))managerState.employeeId=String(employees[0]?.id||"");
      managerState.loadedAt=Date.now();
    }catch(error){managerState.error=error.message||"Arbeitszeitnachweise konnten nicht geladen werden."}
    finally{managerState.loading=false;if(S.adminView==="approvals"&&S.session)renderAdmin()}
  }

  function managerPage(){
    queueMicrotask(()=>ensureManagerData());
    const data=managerState.data||{},employees=data.employees||[],employee=selectedEmployee(),rows=employeeSubmissions(),current=currentPeriodSubmission();
    const snapshot=current?.payload?.snapshot||{},totals=snapshot.totals||{};
    const openDays=Number(totals.openDays||0),canSignedExport=current&&["approved","locked"].includes(current.status)&&current.document_signature_id;
    return `<div class="docsign-hero">
      <div><div class="caps">Arbeitszeitnachweis in zwei klaren Stufen</div><h2>Erst prüfen und exportieren. Dann gezielt bestätigen lassen.</h2><p>Du kannst jederzeit eine Version ohne Mitarbeiterunterschrift herunterladen. Nur wenn du ausdrücklich eine Bestätigung anforderst, prüft und unterschreibt der Mitarbeiter genau diese unveränderbare Version.</p></div>
      <button class="btn light" data-docsign-action="refresh-manager">Aktualisieren</button>
    </div>
    ${managerState.error?`<div class="compliance-alert">${esc(managerState.error)}</div>`:""}
    <div class="docsign-steps">
      <article><b>1</b><span><strong>Zeiten laden</strong><small>Aktuellen Stand inklusive Korrekturen als Entwurf speichern.</small></span></article>
      <article><b>2</b><span><strong>Ohne Unterschrift exportieren</strong><small>PDF oder Excel bleibt klar als unbestätigte Version gekennzeichnet.</small></span></article>
      <article><b>3</b><span><strong>Bestätigung anfordern</strong><small>Der Mitarbeiter prüft dieselbe Version, zeichnet einmalig seine Unterschrift und bestätigt.</small></span></article>
    </div>
    <div class="docsign-manager-grid">
      <article class="dashboard-card docsign-card">
        <div class="dashboard-card-head"><h2>Zeitraum vorbereiten</h2></div>
        <div class="docsign-form-grid">
          <label>Mitarbeiter/in<select class="select" id="docsign-employee-select">${employees.map(item=>`<option value="${esc(item.id)}" ${String(item.id)===managerState.employeeId?"selected":""}>${esc(item.name)} · ${esc(loc(item.locationId||item.primaryLocationId)?.name||"")}</option>`).join("")}</select></label>
          <label>Von<input class="input" id="docsign-date-from" type="date" value="${esc(managerState.dateFrom)}"></label>
          <label>Bis<input class="input" id="docsign-date-to" type="date" value="${esc(managerState.dateTo)}"></label>
        </div>
        <div class="docsign-actions"><button class="btn" data-docsign-action="prepare" data-employee-id="${esc(employee?.id||"")}" ${employee?"":"disabled"}>Aktuelle Zeiten laden</button></div>
        ${current?`<section class="docsign-current">
          <div class="docsign-current-head"><div><div class="caps">Gespeicherte Version ${current.version||1}</div><h3>${formatDate(current.date_from)} – ${formatDate(current.date_to)}</h3><p>${esc(snapshot.location?.name||"Standort")} · ${formatMinutes(totals.totalMinutes)} Gesamt · Differenz ${formatMinutes(totals.differenceMinutes)}</p></div><span class="status-chip ${statusClass(current)}">${statusText(current)}</span></div>
          <div class="docsign-status-line"><span>${snapshot.rows?.length||0} Tage</span><span>${openDays} offene/fehlende Buchungen</span><span>Hash ${esc(String(current.snapshot_hash||"").slice(0,12))}…</span></div>
          ${openDays?`<div class="docsign-warning">Vor einer Mitarbeiterbestätigung müssen offene oder fehlende Zeitbuchungen korrigiert werden. Der Export ohne Unterschrift bleibt trotzdem möglich.</div>`:`<div class="docsign-ok">Diese Version kann zur Bestätigung an den Mitarbeiter gesendet werden.</div>`}
          ${current.employee_note?`<div class="docsign-warning">Korrekturhinweis: ${esc(current.employee_note)}</div>`:""}
          <div class="docsign-actions">
            <button class="btn light" data-docsign-action="view" data-submission-id="${esc(current.id)}" data-mode="manager">Ansehen</button>
            <div class="docsign-button-group"><button data-docsign-action="export" data-submission-id="${esc(current.id)}" data-format="pdf" data-signed="false">PDF ohne Unterschrift</button><button data-docsign-action="export" data-submission-id="${esc(current.id)}" data-format="xlsx" data-signed="false">Excel</button></div>
            ${!["approved","locked"].includes(current.status)?`<button class="btn outline" data-docsign-action="request" data-submission-id="${esc(current.id)}" ${openDays?"disabled":""}>${current.status==="submitted"?"Anfrage erneut senden":"Bestätigung & Unterschrift anfordern"}</button>`:""}
            ${canSignedExport?`<div class="docsign-button-group"><button data-docsign-action="export" data-submission-id="${esc(current.id)}" data-format="pdf" data-signed="true">Bestätigtes PDF</button><button data-docsign-action="export" data-submission-id="${esc(current.id)}" data-format="xlsx" data-signed="true">Bestätigtes Excel</button></div>`:""}
          </div>
        </section>`:`<div class="empty" style="margin-top:18px">Für den gewählten Zeitraum wurde noch keine Vorschau erstellt.</div>`}
      </article>
      <article class="dashboard-card docsign-card">
        <div class="dashboard-card-head"><h2>Mitarbeiter <small>${employees.length}</small></h2></div>
        <div class="docsign-employee-list">${employees.map(item=>{
          const latest=(data.submissions||[]).find(row=>String(row.employee_id)===String(item.id));
          return`<button class="docsign-employee-row ${String(item.id)===managerState.employeeId?"active":""}" data-docsign-action="select-employee" data-employee-id="${esc(item.id)}"><span class="avatar">${esc(item.initials||initials(item.name))}</span><span><strong>${esc(item.name)}</strong><small>${esc(loc(item.locationId||item.primaryLocationId)?.name||"Standort offen")}</small></span><em>${latest?statusText(latest):"Kein Nachweis"}</em></button>`
        }).join("")||'<div class="empty">Keine Mitarbeiter vorhanden.</div>'}</div>
      </article>
    </div>
    <article class="dashboard-card docsign-card"><div class="dashboard-card-head"><h2>Alle Nachweise ${employee?`für ${esc(employee.name)}`:""} <small>${rows.length}</small></h2></div><div class="docsign-list">${rows.map(item=>submissionRow(item,true)).join("")||'<div class="empty">Noch kein Nachweis vorhanden.</div>'}</div></article>`;
  }

  function submissionRow(submission,manager){
    const snapshot=submission.payload?.snapshot||{},totals=snapshot.totals||{},signed=["approved","locked"].includes(submission.status)&&submission.document_signature_id;
    return `<div class="docsign-row"><div><strong>${formatDate(submission.date_from)} – ${formatDate(submission.date_to)}</strong><small>Version ${submission.version||1} · ${formatMinutes(totals.totalMinutes)} Gesamt · ${esc(snapshot.location?.name||"Standort")}</small>${submission.employee_note?`<p>${esc(submission.employee_note)}</p>`:""}</div><span class="status-chip ${statusClass(submission)}">${statusText(submission)}</span><div class="docsign-row-actions"><button class="btn light" data-docsign-action="view" data-submission-id="${esc(submission.id)}" data-mode="${manager?"manager":"employee"}">Ansehen</button>${manager?`<div class="docsign-button-group"><button data-docsign-action="export" data-submission-id="${esc(submission.id)}" data-format="pdf" data-signed="false">PDF ohne Signatur</button>${signed?`<button data-docsign-action="export" data-submission-id="${esc(submission.id)}" data-format="pdf" data-signed="true">PDF bestätigt</button>`:""}</div>`:""}</div></div>`;
  }

  const previousEmployeeView=employeeView;
  employeeView=function(employee,view){
    if(view==="documents")return employeeDocumentsPage(employee);
    let html=previousEmployeeView(employee,view);
    if(view!=="more")return html;
    html=String(html).replace(/<article class="timesheet-employee-entry">[\s\S]*?<\/article>/g,"");
    return `${html}<article class="docsign-employee-entry"><div><div class="caps muted">Arbeitszeitnachweise</div><h2>Prüfen & einmalig unterschreiben</h2><p>Deine Unterschrift wird nur für den ausgewählten Nachweis gespeichert und nie für spätere Dokumente wiederverwendet.</p></div><button class="btn" data-docsign-action="open-employee">Öffnen</button></article>`;
  };
  async function ensureEmployeeData(force=false){
    if(employeeState.loading)return;
    if(!force&&employeeState.loadedAt&&Date.now()-employeeState.loadedAt<12000)return;
    employeeState.loading=true;employeeState.error="";
    try{employeeState.data=await call("employeeInbox");employeeState.loadedAt=Date.now()}
    catch(error){employeeState.error=error.message||"Arbeitszeitnachweise konnten nicht geladen werden."}
    finally{employeeState.loading=false;if(S.employeeView==="documents"&&S.session)renderEmployee()}
  }
  function employeeDocumentsPage(employee){
    queueMicrotask(()=>ensureEmployeeData());
    const submissions=employeeState.data?.submissions||[],pending=submissions.filter(item=>item.status==="submitted").length;
    return `<div class="employee-page-title"><div><div class="caps muted">Persönliche Dokumente</div><h1>Arbeitszeitnachweise</h1></div><button class="btn light" data-docsign-action="close-employee">Zurück</button></div>
      ${employeeState.error?`<div class="compliance-alert">${esc(employeeState.error)}</div>`:""}
      <article class="docsign-mobile-intro"><div class="caps">Einmalige Dokumentunterschrift</div><h2>Du entscheidest bei jedem Nachweis neu.</h2><p>Es wird keine allgemeine oder wiederverwendbare Unterschrift hinterlegt. Erst nach deiner Prüfung zeichnest du die Unterschrift direkt für genau diese Version.</p></article>
      <article class="docsign-mobile-card"><div class="docsign-mobile-card-head"><div><div class="caps">Offene Aufgaben</div><h2>${pending?`${pending} Nachweis${pending===1?"":"e"} wartet${pending===1?"":"en"}`:"Alles erledigt"}</h2></div><button class="circle-btn" data-docsign-action="refresh-employee" aria-label="Aktualisieren">↻</button></div><div class="docsign-mobile-list">${submissions.map(item=>submissionMobileRow(item)).join("")||'<div class="empty">Noch kein Nachweis vorhanden.</div>'}</div></article>`;
  }
  function submissionMobileRow(submission){
    const snapshot=submission.payload?.snapshot||{},totals=snapshot.totals||{};
    return `<div class="docsign-mobile-row"><div class="docsign-mobile-row-top"><div><strong>${formatDate(submission.date_from)} – ${formatDate(submission.date_to)}</strong><small>Version ${submission.version||1} · ${formatMinutes(totals.totalMinutes)} · ${esc(snapshot.location?.name||"Standort")}</small></div><span class="status-chip ${statusClass(submission)}">${statusText(submission)}</span></div>${submission.employee_note?`<p>${esc(submission.employee_note)}</p>`:""}<div class="docsign-actions"><button class="btn ${submission.status==="submitted"?"":"light"}" data-docsign-action="view" data-submission-id="${esc(submission.id)}" data-mode="employee">${submission.status==="submitted"?"Prüfen & unterschreiben":"Ansehen"}</button></div></div>`;
  }

  function dialogRoot(){let dialog=document.getElementById("timesheet-document-signing-dialog");if(!dialog){dialog=document.createElement("dialog");dialog.id="timesheet-document-signing-dialog";dialog.className="docsign-dialog";document.body.appendChild(dialog)}return dialog}
  function closeDialog(){const dialog=dialogRoot();if(dialog.open)dialog.close()}
  function findSubmission(id,mode){const rows=mode==="manager"?(managerState.data?.submissions||[]):(employeeState.data?.submissions||[]);return rows.find(item=>String(item.id)===String(id))}
  function openSubmissionDialog(submission,mode){
    const snapshot=submission.payload?.snapshot||{},rows=snapshot.rows||[],canDecide=mode==="employee"&&submission.status==="submitted",dialog=dialogRoot();
    const consentText=employeeState.data?.consentText||"Ich bestätige diesen Arbeitszeitnachweis und willige ein, dass meine jetzt gezeichnete Unterschrift ausschließlich für diese Dokumentversion gespeichert und verwendet wird.";
    dialog.innerHTML=`<div class="docsign-dialog-inner"><div class="docsign-dialog-head"><div><div class="caps">Arbeitszeitnachweis · Version ${submission.version||1}</div><h2>${esc(snapshot.employee?.name||"Mitarbeiter/in")}</h2><p>${formatDate(snapshot.period?.from)} – ${formatDate(snapshot.period?.to)} · ${esc(snapshot.location?.name||"")}</p></div><button class="circle-btn" data-docsign-action="close-dialog">${I.x}</button></div>
      <div class="docsign-document-meta"><span><small>Standort</small><strong>${esc(snapshot.location?.name||"–")}</strong><em>${esc([snapshot.location?.address,snapshot.location?.postalCode,snapshot.location?.city].filter(Boolean).join(", "))}</em></span><span><small>Gesamt</small><strong>${formatMinutes(snapshot.totals?.totalMinutes)}</strong><em>Differenz ${formatMinutes(snapshot.totals?.differenceMinutes)}</em></span><span><small>Status</small><strong>${statusText(submission)}</strong><em>${submission.approval_requested_at?`Angefordert ${formatDateTime(submission.approval_requested_at)}`:"Noch nicht angefordert"}</em></span></div>
      <div class="docsign-document-table"><table><thead><tr><th>Datum</th><th>Art</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Netto</th><th>Bemerkung</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${formatDate(row.date)}</td><td>${esc(row.type)}</td><td>${esc(row.start||"–")}</td><td>${esc(row.end||"–")}</td><td>${Number(row.breakMinutes)||0} Min.</td><td><strong>${formatMinutes(row.netMinutes)}</strong></td><td>${esc(row.note||"")}</td></tr>`).join("")}</tbody></table></div>
      <div class="docsign-hash"><strong>Diese Entscheidung gilt exakt für diesen Inhalt</strong><code>${esc(submission.snapshot_hash||"")}</code></div>
      ${canDecide?`<section class="docsign-decision"><label>Korrekturhinweis oder optionale Notiz<textarea class="input" id="docsign-decision-note" placeholder="Bei einer Korrekturanfrage bitte den Fehler genau beschreiben."></textarea></label><label class="docsign-signature-consent"><input type="checkbox" id="docsign-consent"><span><strong>Einmalige Bestätigung und Einwilligung</strong><p>${esc(consentText)}</p></span></label><div class="docsign-signature-box"><strong>Jetzt für diesen Nachweis unterschreiben</strong><small>Mit Finger, Maus oder Stift zeichnen. Diese Zeichnung wird nicht als allgemeine Unterschrift gespeichert.</small><canvas id="docsign-signature-canvas" width="760" height="220" aria-label="Unterschrift für diesen Arbeitszeitnachweis"></canvas><button class="btn light" type="button" data-docsign-action="clear-signature">Feld leeren</button></div><div class="docsign-dialog-actions"><button class="btn light" data-docsign-action="decide" data-decision="declined" data-submission-id="${esc(submission.id)}">Korrektur anfordern</button><button class="btn" data-docsign-action="decide" data-decision="approved" data-submission-id="${esc(submission.id)}">Bestätigen & unterschreiben</button></div></section>`:`<div class="docsign-dialog-actions"><button class="btn" data-docsign-action="close-dialog">Schließen</button></div>`}</div>`;
    dialog.showModal();if(canDecide)setupSignatureCanvas();
  }
  function setupSignatureCanvas(){
    const canvas=document.getElementById("docsign-signature-canvas");if(!canvas)return;
    const context=canvas.getContext("2d");context.lineWidth=4;context.lineCap="round";context.lineJoin="round";context.strokeStyle="#151515";canvas.dataset.dirty="false";let drawing=false;
    const point=event=>{const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height}};
    canvas.addEventListener("pointerdown",event=>{drawing=true;canvas.setPointerCapture(event.pointerId);const p=point(event);context.beginPath();context.moveTo(p.x,p.y);event.preventDefault()});
    canvas.addEventListener("pointermove",event=>{if(!drawing)return;const p=point(event);context.lineTo(p.x,p.y);context.stroke();canvas.dataset.dirty="true";event.preventDefault()});
    const stop=()=>{drawing=false};canvas.addEventListener("pointerup",stop);canvas.addEventListener("pointercancel",stop);canvas.addEventListener("pointerleave",stop);
  }

  document.addEventListener("change",event=>{
    if(event.target.id==="docsign-employee-select"){managerState.employeeId=String(event.target.value||"");renderAdmin()}
    if(event.target.id==="docsign-date-from"){managerState.dateFrom=String(event.target.value||"");renderAdmin()}
    if(event.target.id==="docsign-date-to"){managerState.dateTo=String(event.target.value||"");renderAdmin()}
  });
  document.addEventListener("click",async event=>{
    const button=event.target.closest("[data-docsign-action]");if(!button)return;
    const action=button.dataset.docsignAction;
    if(action==="close-dialog")return closeDialog();
    if(action==="open-employee"){S.employeeView="documents";renderEmployee();return}
    if(action==="close-employee"){S.employeeView="more";renderEmployee();return}
    if(action==="refresh-manager"){await ensureManagerData(true);return}
    if(action==="refresh-employee"){await ensureEmployeeData(true);return}
    if(action==="select-employee"){managerState.employeeId=String(button.dataset.employeeId||"");renderAdmin();return}
    if(action==="view"){const submission=findSubmission(button.dataset.submissionId,button.dataset.mode);if(submission)openSubmissionDialog(submission,button.dataset.mode);return}
    if(action==="clear-signature"){const canvas=document.getElementById("docsign-signature-canvas");if(canvas){canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);canvas.dataset.dirty="false"}return}
    if(action==="prepare"){
      if(!managerState.dateFrom||!managerState.dateTo)return toast("Bitte einen vollständigen Zeitraum auswählen.","error");
      const existing=currentPeriodSubmission();if(existing?.status==="submitted"&&!confirm("Die aktuelle Anfrage an den Mitarbeiter wird durch eine neue Version ersetzt. Fortfahren?"))return;
      button.disabled=true;try{await call("prepareTimesheet",{employeeId:button.dataset.employeeId,dateFrom:managerState.dateFrom,dateTo:managerState.dateTo});toast("Aktuelle Arbeitszeiten wurden als neue Version gespeichert.");await ensureManagerData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="request"){
      button.disabled=true;try{await call("requestApproval",{submissionId:button.dataset.submissionId});toast("Die Bestätigung und einmalige Unterschrift wurden beim Mitarbeiter angefordert.");await ensureManagerData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="export"){
      button.disabled=true;try{const result=await download(button.dataset.submissionId,button.dataset.format,button.dataset.signed==="true");toast(`${result.filename} wurde erstellt.`);await ensureManagerData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}return;
    }
    if(action==="decide"){
      const decision=button.dataset.decision,note=String(document.getElementById("docsign-decision-note")?.value||"").trim();
      if(decision==="declined"&&note.length<5)return toast("Bitte beschreibe die gewünschte Korrektur.","error");
      const payload={submissionId:button.dataset.submissionId,decision,note};
      if(decision==="approved"){
        const consent=document.getElementById("docsign-consent"),canvas=document.getElementById("docsign-signature-canvas");
        if(!consent?.checked)return toast("Bitte bestätige die einmalige dokumentbezogene Einwilligung.","error");
        if(canvas?.dataset.dirty!=="true")return toast("Bitte unterschreibe im vorgesehenen Feld.","error");
        payload.consentAccepted=true;payload.signatureDataUrl=canvas.toDataURL("image/png");
      }
      button.disabled=true;try{await call("decideTimesheet",payload);closeDialog();toast(decision==="approved"?"Der Nachweis wurde bestätigt und einmalig unterschrieben.":"Die Korrekturanfrage wurde gesendet.");await ensureEmployeeData(true)}catch(error){toast(error.message,"error")}finally{button.disabled=false}
    }
  });
})();
