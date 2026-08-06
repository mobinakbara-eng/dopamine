"use strict";

(function installOptionalTimesheetSignature(){
  if(window.__aoraOptionalTimesheetSignatureInstalled)return;
  window.__aoraOptionalTimesheetSignatureInstalled=true;
  const OPTIONAL_FUNCTION="aora-v8-timesheet-optional-approval";
  const DOCUMENT_FUNCTION="aora-v8-timesheet-document-signing";
  let unsignedIds=new Set(),requiredIds=new Set(),policies=new Map(),lastDialogSubmissionId="",refreshing=false,settingsRefreshing=false,settingsLoadedAt=0,unsignedLoadedAt=0;
  function callOptional(action,payload={}){return request(OPTIONAL_FUNCTION,{action,token:S.session?.token,...payload})}
  function callDocument(action,payload={}){return request(DOCUMENT_FUNCTION,{action,token:S.session?.token,...payload})}
  function currentDate(){return typeof berlin==="function"?berlin().date:new Date().toISOString().slice(0,10)}
  async function refreshSettings(force=false){
    if(!S?.session||settingsRefreshing)return;
    if(!force&&settingsLoadedAt&&Date.now()-settingsLoadedAt<10000)return;
    settingsRefreshing=true;
    try{
      const data=await callOptional("signatureSettings");
      policies=new Map((data.policies||[]).map(item=>[String(item.employee_id),Boolean(item.signature_required)]));
      requiredIds=new Set((data.submissions||[]).filter(item=>item.signature_required).map(item=>String(item.id)));
      settingsLoadedAt=Date.now();
      enhanceManagerPolicy();enhanceDialog();
    }catch(error){console.warn("Signature settings could not be loaded",error)}finally{settingsRefreshing=false}
  }
  async function refreshUnsigned(force=false){
    if(refreshing||!S?.session)return;
    if(!force&&unsignedLoadedAt&&Date.now()-unsignedLoadedAt<10000)return applyStatusLabels();
    refreshing=true;
    try{const data=await callOptional("unsignedApprovals");unsignedIds=new Set((data.submissions||[]).map(item=>String(item.id)));unsignedLoadedAt=Date.now();applyStatusLabels()}
    catch(error){console.warn("Optional approval status could not be loaded",error)}finally{refreshing=false}
  }
  function setText(root,from,to){
    for(const node of root.querySelectorAll("h1,h2,h3,p,small,strong,button,.caps"))if(node.childElementCount===0&&node.textContent.includes(from))node.textContent=node.textContent.replace(from,to)
  }
  function patchCopy(root=document){
    setText(root,"Prüfen & einmalig unterschreiben","Prüfen & optional unterschreiben");
    setText(root,"Einmalige Dokumentunterschrift","Optionale Dokumentunterschrift");
    setText(root,"Du entscheidest bei jedem Nachweis neu.","Du entscheidest bei jedem Nachweis, ob du unterschreiben möchtest.");
    setText(root,"Bestätigung & Unterschrift anfordern","Bestätigung anfordern");
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
      dialog.removeAttribute("open");dialog.hidden=false;
    }
  }
  function enhanceManagerPolicy(){
    const select=document.getElementById("docsign-employee-select");if(!select)return;
    const host=select.closest("label")?.parentElement;if(!host||host.querySelector(".docsign-policy-control"))return;
    const employeeId=String(select.value||"");const required=policies.get(employeeId)===true;
    const box=document.createElement("div");box.className="docsign-policy-control";box.innerHTML=`<span><strong>Unterschrift für diesen Mitarbeiter</strong><small>Gilt für neu gesendete Nachweise.</small></span><div><button type="button" data-signature-policy="optional" data-employee-id="${employeeId}" class="${required?"":"active"}">Optional</button><button type="button" data-signature-policy="required" data-employee-id="${employeeId}" class="${required?"active":""}">Erforderlich</button></div>`;host.appendChild(box);
  }
  async function savePolicy(button){
    const required=button.dataset.signaturePolicy==="required",employeeId=String(button.dataset.employeeId||"");button.disabled=true;
    try{
      await callOptional("setSignatureRequirement",{employeeId,signatureRequired:required});
      policies.set(employeeId,required);settingsLoadedAt=Date.now();
      document.querySelector(".docsign-policy-control")?.remove();enhanceManagerPolicy();
      toast(required?"Unterschrift ist für neue Nachweise erforderlich.":"Unterschrift ist für neue Nachweise optional.");
    }catch(error){toast(error.message||"Einstellung konnte nicht gespeichert werden.","error")}finally{if(button.isConnected)button.disabled=false}
  }
  function enhanceDialog(){
    const dialog=document.getElementById("timesheet-document-signing-dialog");
    const decision=dialog?.querySelector(".docsign-decision");if(!decision||decision.dataset.optionalReady==="true")return;
    decision.dataset.optionalReady="true";
    const consent=decision.querySelector(".docsign-signature-consent"),signatureBox=decision.querySelector(".docsign-signature-box"),approve=decision.querySelector('[data-docsign-action="decide"][data-decision="approved"]');
    if(!consent||!signatureBox||!approve)return;
    const required=requiredIds.has(String(approve.dataset.submissionId));
    if(required){
      consent.hidden=false;signatureBox.hidden=false;approve.textContent="Bestätigen & unterschreiben";
      const note=document.createElement("div");note.className="docsign-required-note";note.innerHTML="<strong>Unterschrift erforderlich</strong><small>Der Manager hat die Unterschrift für diesen Nachweis verpflichtend eingestellt.</small>";consent.before(note);return;
    }
    const option=document.createElement("label");option.className="docsign-optional-toggle";option.innerHTML='<input type="checkbox" id="docsign-use-signature"><span><strong>Mit Unterschrift bestätigen</strong><small>Optional. Ohne Haken wird nur deine Bestätigung dokumentiert.</small></span>';
    consent.before(option);consent.hidden=true;signatureBox.hidden=true;approve.textContent="Ohne Unterschrift bestätigen";
    const toggle=option.querySelector("input");
    toggle.addEventListener("change",event=>{const checked=event.target.checked;consent.hidden=!checked;signatureBox.hidden=!checked;approve.textContent=checked?"Bestätigen & unterschreiben":"Ohne Unterschrift bestätigen"});
    approve.addEventListener("click",event=>{if(toggle.checked)return;event.preventDefault();event.stopImmediatePropagation();approveWithoutSignature(approve)},true);
  }
  async function approveWithoutSignature(button){
    const note=String(document.getElementById("docsign-decision-note")?.value||"").trim();
    const dialog=button.closest("dialog");button.disabled=true;
    if(dialog){try{if(typeof dialog.close==="function"&&dialog.open)dialog.close()}catch{}dialog.removeAttribute("open");dialog.hidden=true}
    try{
      await callOptional("approveWithoutSignature",{submissionId:button.dataset.submissionId,note});
      unsignedIds.add(String(button.dataset.submissionId));unsignedLoadedAt=Date.now();closeApprovalDialogs();toast("Der Nachweis wurde ohne Unterschrift bestätigt.");
      queueMicrotask(()=>document.querySelector('[data-docsign-action="refresh-employee"]')?.click());
      setTimeout(()=>{closeApprovalDialogs();patchCopy();applyStatusLabels()},150);
    }catch(error){
      if(dialog?.isConnected){dialog.hidden=false;try{if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal()}catch{}}
      toast(error.message||"Bestätigung konnte nicht gespeichert werden.","error");
    }finally{if(button.isConnected)button.disabled=false}
  }
  async function requestOptional(button){
    button.disabled=true;
    try{
      const result=await callOptional("requestOptionalApproval",{submissionId:button.dataset.submissionId});
      const required=Boolean(result?.submission?.signature_required);
      toast(required?"Der Nachweis wurde gesendet. Die Unterschrift ist erforderlich.":"Der Nachweis wurde gesendet. Die Unterschrift ist optional.");
      document.querySelector('[data-docsign-action="refresh-manager"]')?.click();
    }catch(error){toast(error.message||"Anfrage konnte nicht gesendet werden.","error")}finally{if(button.isConnected)button.disabled=false}
  }
  async function prepareAndRequest(button){
    const employeeId=String(button.dataset.employeeId||document.getElementById("docsign-employee-select")?.value||""),from=String(document.getElementById("docsign-date-from")?.value||""),toInput=document.getElementById("docsign-date-to"),today=currentDate();let to=String(toInput?.value||"");
    if(to>today){to=today;if(toInput)toInput.value=today}if(!employeeId||!from||!to)return toast("Bitte Mitarbeiter und Zeitraum vollständig auswählen.","error");
    button.disabled=true;try{const prepared=await callDocument("prepareTimesheet",{employeeId,dateFrom:from,dateTo:to}),submission=prepared?.submission;if(!submission?.id)throw new Error("Nachweis konnte nicht erstellt werden.");if(Number(submission.payload?.snapshot?.totals?.openDays||0)>0)throw new Error("Offene oder fehlende Buchungen müssen zuerst korrigiert werden.");await callOptional("requestOptionalApproval",{submissionId:submission.id});toast("Nachweis wurde gesendet.");document.querySelector('[data-docsign-action="refresh-manager"]')?.click()}
    catch(error){toast(error.message||"Nachweis konnte nicht gesendet werden.","error")}finally{if(button.isConnected)button.disabled=false}
  }
  window.addEventListener("click",event=>{
    const view=event.target?.closest?.('[data-docsign-action="view"][data-submission-id]');if(view){lastDialogSubmissionId=String(view.dataset.submissionId||"");refreshSettings(true)}
    const prepare=event.target?.closest?.('[data-docnotice-action="prepare-send"]');if(prepare){event.preventDefault();event.stopImmediatePropagation();prepareAndRequest(prepare);return}
  },true);
  document.addEventListener("change",event=>{if(event.target?.id==="docsign-employee-select"){document.querySelector(".docsign-policy-control")?.remove();enhanceManagerPolicy()}},true);
  document.addEventListener("click",event=>{
    const policyButton=event.target?.closest?.("[data-signature-policy]");if(policyButton){event.preventDefault();event.stopImmediatePropagation();savePolicy(policyButton);return}
    const button=event.target?.closest?.("[data-docsign-action]");if(!button)return;
    if(button.dataset.docsignAction==="refresh-manager"){unsignedLoadedAt=0;queueMicrotask(()=>refreshUnsigned(true));return}
    if(button.dataset.docsignAction==="refresh-employee"){settingsLoadedAt=0;queueMicrotask(()=>refreshSettings(true));return}
    if(button.dataset.docsignAction==="request"){event.preventDefault();event.stopImmediatePropagation();requestOptional(button);return}
  },true);
  const observer=new MutationObserver(()=>{patchCopy();enhanceManagerPolicy();enhanceDialog();applyStatusLabels();if(S?.session)queueMicrotask(()=>{refreshUnsigned();refreshSettings()})});
  const root=document.getElementById("app");if(root)observer.observe(root,{childList:true,subtree:true});
  const dialogObserver=new MutationObserver(()=>{enhanceDialog();patchCopy(document.getElementById("timesheet-document-signing-dialog")||document);applyStatusLabels()});
  dialogObserver.observe(document.body,{childList:true,subtree:true});
  queueMicrotask(()=>{patchCopy();refreshUnsigned(true);refreshSettings(true)});
})();