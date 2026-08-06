"use strict";

(function installOptionalTimesheetSignature(){
  if(window.__aoraOptionalTimesheetSignatureInstalled)return;
  window.__aoraOptionalTimesheetSignatureInstalled=true;
  const OPTIONAL_FUNCTION="aora-v8-timesheet-optional-approval";
  const DOCUMENT_FUNCTION="aora-v8-timesheet-document-signing";
  let unsignedIds=new Set(),lastDialogSubmissionId="",refreshing=false;
  function callOptional(action,payload={}){return request(OPTIONAL_FUNCTION,{action,token:S.session?.token,...payload})}
  function callDocument(action,payload={}){return request(DOCUMENT_FUNCTION,{action,token:S.session?.token,...payload})}
  function currentDate(){return typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10)}
  async function refreshUnsigned(force=false){
    if(refreshing||!S?.session)return;
    if(!force&&unsignedIds.size)return applyStatusLabels();
    refreshing=true;
    try{const data=await callOptional("unsignedApprovals");unsignedIds=new Set((data.submissions||[]).map(item=>String(item.id)));applyStatusLabels()}
    catch(error){console.warn("Optional approval status could not be loaded",error)}finally{refreshing=false}
  }
  function setText(root,from,to){
    for(const node of root.querySelectorAll("h1,h2,h3,p,small,strong,button,.caps"))if(node.childElementCount===0&&node.textContent.includes(from))node.textContent=node.textContent.replace(from,to)
  }
  function patchCopy(root=document){
    setText(root,"Prüfen & einmalig unterschreiben","Prüfen & optional unterschreiben");
    setText(root,"Einmalige Dokumentunterschrift","Optionale Dokumentunterschrift");
    setText(root,"Du entscheidest bei jedem Nachweis neu.","Du entscheidest bei jedem Nachweis, ob du unterschreiben möchtest.");
    setText(root,"Bestätigung & Unterschrift anfordern","Bestätigung anfordern · Unterschrift optional");
    setText(root,"Prüfen & unterschreiben","Prüfen & bestätigen");
    setText(root,"Erst prüfen und exportieren. Dann gezielt bestätigen lassen.","Erst prüfen und exportieren. Dann einfach bestätigen lassen.");
  }
  function applyStatusLabels(){
    for(const id of unsignedIds){
      const targets=[...document.querySelectorAll(`[data-submission-id="${CSS.escape(id)}"]`)];
      for(const target of targets){
        const container=target.closest(".docsign-row,.docsign-mobile-row,.docsign-current,.docsign-dialog-inner");
        const chip=container?.querySelector(".status-chip");if(chip){chip.textContent="Bestätigt · ohne Unterschrift";chip.classList.add("black")}
      }
      if(lastDialogSubmissionId===id){
        const dialog=document.getElementById("timesheet-document-signing-dialog");
        const status=dialog?.querySelector(".docsign-document-meta span:nth-child(3) strong");if(status)status.textContent="Bestätigt · ohne Unterschrift";
      }
    }
  }
  function closeApprovalDialogs(){
    for(const dialog of document.querySelectorAll("#timesheet-document-signing-dialog")){
      try{if(typeof dialog.close==="function"&&dialog.open)dialog.close()}catch{}
      dialog.removeAttribute("open");
    }
  }
  function enhanceDialog(){
    const dialog=document.getElementById("timesheet-document-signing-dialog");
    const decision=dialog?.querySelector(".docsign-decision");if(!decision||decision.dataset.optionalReady==="true")return;
    decision.dataset.optionalReady="true";
    const consent=decision.querySelector(".docsign-signature-consent"),signatureBox=decision.querySelector(".docsign-signature-box"),approve=decision.querySelector('[data-docsign-action="decide"][data-decision="approved"]');
    if(!consent||!signatureBox||!approve)return;
    const option=document.createElement("label");option.className="docsign-optional-toggle";option.innerHTML='<input type="checkbox" id="docsign-use-signature"><span><strong>Mit Unterschrift bestätigen</strong><small>Optional. Ohne Haken wird nur deine Bestätigung dokumentiert.</small></span>';
    consent.before(option);consent.hidden=true;signatureBox.hidden=true;approve.textContent="Ohne Unterschrift bestätigen";
    const toggle=option.querySelector("input");
    toggle.addEventListener("change",event=>{const checked=event.target.checked;consent.hidden=!checked;signatureBox.hidden=!checked;approve.textContent=checked?"Bestätigen & unterschreiben":"Ohne Unterschrift bestätigen"});
    approve.addEventListener("click",event=>{if(toggle.checked)return;event.preventDefault();event.stopImmediatePropagation();approveWithoutSignature(approve)},true);
  }
  async function approveWithoutSignature(button){
    const note=String(document.getElementById("docsign-decision-note")?.value||"").trim();
    const dialog=button.closest("dialog");
    button.disabled=true;
    if(dialog){
      try{if(typeof dialog.close==="function"&&dialog.open)dialog.close()}catch{}
      dialog.removeAttribute("open");
      dialog.hidden=true;
    }
    try{
      await callOptional("approveWithoutSignature",{submissionId:button.dataset.submissionId,note});
      unsignedIds.add(String(button.dataset.submissionId));
      closeApprovalDialogs();
      toast("Der Nachweis wurde ohne Unterschrift bestätigt.");
      queueMicrotask(()=>document.querySelector('[data-docsign-action="refresh-employee"]')?.click());
      setTimeout(()=>{closeApprovalDialogs();patchCopy();applyStatusLabels()},150);
    }
    catch(error){
      if(dialog?.isConnected){
        dialog.hidden=false;
        try{if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal()}catch{}
      }
      toast(error.message||"Bestätigung konnte nicht gespeichert werden.","error");
    }
    finally{if(button.isConnected)button.disabled=false}
  }
  async function requestOptional(button){
    button.disabled=true;try{await callOptional("requestOptionalApproval",{submissionId:button.dataset.submissionId});toast("Der Nachweis wurde zur Prüfung gesendet. Die Unterschrift ist optional.");document.querySelector('[data-docsign-action="refresh-manager"]')?.click()}
    catch(error){toast(error.message||"Anfrage konnte nicht gesendet werden.","error")}finally{if(button.isConnected)button.disabled=false}
  }
  async function prepareAndRequest(button){
    const employeeId=String(button.dataset.employeeId||document.getElementById("docsign-employee-select")?.value||""),from=String(document.getElementById("docsign-date-from")?.value||""),toInput=document.getElementById("docsign-date-to"),today=currentDate();let to=String(toInput?.value||"");
    if(to>today){to=today;if(toInput)toInput.value=today}if(!employeeId||!from||!to)return toast("Bitte Mitarbeiter und Zeitraum vollständig auswählen.","error");
    button.disabled=true;try{const prepared=await callDocument("prepareTimesheet",{employeeId,dateFrom:from,dateTo:to}),submission=prepared?.submission;if(!submission?.id)throw new Error("Nachweis konnte nicht erstellt werden.");if(Number(submission.payload?.snapshot?.totals?.openDays||0)>0)throw new Error("Offene oder fehlende Buchungen müssen zuerst korrigiert werden.");await callOptional("requestOptionalApproval",{submissionId:submission.id});toast("Nachweis wurde gesendet. Bestätigung ist mit oder ohne Unterschrift möglich.");document.querySelector('[data-docsign-action="refresh-manager"]')?.click()}
    catch(error){toast(error.message||"Nachweis konnte nicht gesendet werden.","error")}finally{if(button.isConnected)button.disabled=false}
  }
  window.addEventListener("click",event=>{
    const view=event.target?.closest?.('[data-docsign-action="view"][data-submission-id]');if(view)lastDialogSubmissionId=String(view.dataset.submissionId||"");
    const prepare=event.target?.closest?.('[data-docnotice-action="prepare-send"]');if(prepare){event.preventDefault();event.stopImmediatePropagation();prepareAndRequest(prepare);return}
  },true);
  document.addEventListener("click",event=>{
    const button=event.target?.closest?.("[data-docsign-action]");if(!button)return;
    if(button.dataset.docsignAction==="request"){event.preventDefault();event.stopImmediatePropagation();requestOptional(button);return}
  },true);
  const observer=new MutationObserver(()=>{patchCopy();enhanceDialog();applyStatusLabels();if(S?.session)queueMicrotask(()=>refreshUnsigned())});
  const root=document.getElementById("app");if(root)observer.observe(root,{childList:true,subtree:true});
  const dialogObserver=new MutationObserver(()=>{enhanceDialog();patchCopy(document.getElementById("timesheet-document-signing-dialog")||document);applyStatusLabels()});
  dialogObserver.observe(document.body,{childList:true,subtree:true});
  queueMicrotask(()=>{patchCopy();refreshUnsigned(true)});
})();
