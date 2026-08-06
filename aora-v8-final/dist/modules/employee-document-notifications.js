"use strict";

(function installEmployeeDocumentNotifications(){
  if(window.__aoraEmployeeDocumentNotificationsInstalled)return;
  window.__aoraEmployeeDocumentNotificationsInstalled=true;

  const FUNCTION_NAME="aora-v8-timesheet-document-signing";
  const inbox={data:null,loading:false,error:"",loadedAt:0};
  let pollTimer=0;
  let renderScheduled=false;

  const employeeSession=()=>Boolean(S?.session&&(S.accessRole==="employee"||S.role==="employee"));
  const token=()=>S?.session?.token||"";
  const subjectId=()=>String(S?.session?.subjectId||S?.session?.subject_id||"");
  const pendingRows=()=>Array.isArray(inbox.data?.submissions)?inbox.data.submissions.filter(item=>item?.status==="submitted"):[];
  const formatDate=value=>{
    if(!value)return"–";
    try{return new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString("de-DE",{timeZone:"UTC"})}
    catch{return String(value)}
  };
  const call=(action,payload={})=>request(FUNCTION_NAME,{action,token:token(),...payload});

  function scheduleEmployeeRender(){
    if(renderScheduled||!employeeSession()||typeof renderEmployee!=="function")return;
    renderScheduled=true;
    requestAnimationFrame(()=>{
      renderScheduled=false;
      if(employeeSession())renderEmployee();
    });
  }

  async function ensureInbox(force=false){
    if(!employeeSession()||!token()||inbox.loading)return;
    if(!force&&inbox.loadedAt&&Date.now()-inbox.loadedAt<7000)return;
    inbox.loading=true;
    try{
      const next=await call("employeeInbox");
      const before=pendingRows().map(item=>String(item.id)).sort().join(",");
      inbox.data=next||{submissions:[]};
      inbox.error="";
      inbox.loadedAt=Date.now();
      const after=pendingRows().map(item=>String(item.id)).sort().join(",");
      if(before!==after||!document.querySelector(".employee-app"))scheduleEmployeeRender();
      else updateBadges();
    }catch(error){
      inbox.error=error?.message||"Offene Nachweise konnten nicht geladen werden.";
      inbox.loadedAt=Date.now();
    }finally{inbox.loading=false}
  }

  function snapshotUnreadCount(){
    const id=subjectId();
    const notes=Array.isArray(S?.state?.notifications)?S.state.notifications:[];
    return notes.filter(note=>{
      const employeeId=String(note?.employeeId??note?.employee_id??"");
      return employeeId===id&&note?.read!==true&&note?.type!=="timesheet_approval";
    }).length;
  }
  function totalCount(){return pendingRows().length+snapshotUnreadCount()}

  function setBadge(button,count,positioned=false){
    if(!button)return;
    let badge=button.querySelector(":scope > .badge-count");
    if(!badge){
      badge=document.createElement("b");
      badge.className="badge-count";
      if(positioned){badge.style.right="16px";badge.style.top="8px"}
      button.appendChild(badge);
    }
    const nextText=String(count),hidden=count<1,nextDisplay=hidden?"none":"grid";
    if(badge.textContent!==nextText)badge.textContent=nextText;
    if(badge.hidden!==hidden)badge.hidden=hidden;
    if(badge.style.display!==nextDisplay)badge.style.display=nextDisplay;
  }
  function updateBadges(){
    if(!employeeSession())return;
    const count=totalCount();
    const headerButton=document.querySelector(".employee-header-actions .circle-btn:not([data-a='logout'])");
    if(headerButton){
      headerButton.classList.add("docnotice-header-button");
      headerButton.dataset.docnoticeAction="open-inbox";
      const label=count?`${count} offene Benachrichtigungen`:"Benachrichtigungen";
      if(headerButton.getAttribute("aria-label")!==label)headerButton.setAttribute("aria-label",label);
      setBadge(headerButton,count,false);
    }
    const moreButton=document.querySelector('.employee-bottom [data-a="employee-view"][data-view="more"]');
    setBadge(moreButton,count,true);
  }

  function banner(){
    const pending=pendingRows();
    if(!pending.length)return"";
    const first=pending[0];
    const period=`${formatDate(first.date_from)} – ${formatDate(first.date_to)}`;
    const title=pending.length===1?"Ein Arbeitszeitnachweis wartet auf deine Bestätigung":`${pending.length} Arbeitszeitnachweise warten auf deine Bestätigung`;
    return `<article class="docnotice-banner docnotice-pulse" role="status" aria-live="polite">
      <span class="docnotice-banner-icon">${I.bell}</span>
      <div><div class="caps">Aktion erforderlich</div><h2>${esc(title)}</h2><p>${esc(period)}${pending.length>1?` · plus ${pending.length-1} weitere`:""}. Bitte prüfe den Nachweis und unterschreibe nur diese konkrete Version.</p></div>
      <button class="btn" data-docsign-action="open-employee">Jetzt prüfen</button>
    </article>`;
  }

  const previousEmployeeView=employeeView;
  employeeView=function(employee,view){
    const base=previousEmployeeView(employee,view);
    if(!employeeSession())return base;
    queueMicrotask(()=>ensureInbox());
    if(view==="documents")return base;
    return `${banner()}${base}`;
  };

  const previousRenderEmployee=renderEmployee;
  renderEmployee=function(...args){
    const result=previousRenderEmployee(...args);
    queueMicrotask(()=>{
      updateBadges();
      ensureInbox();
    });
    return result;
  };
  window.renderEmployee=renderEmployee;

  function refreshManagerDocuments(){
    setTimeout(()=>{
      const refresh=document.querySelector('[data-docsign-action="refresh-manager"]');
      if(refresh)refresh.click();
      else if(typeof renderAdmin==="function"&&S?.session)renderAdmin();
    },30);
  }

  function decorateManagerDocuments(){
    const prepare=document.querySelector('[data-docsign-action="prepare"]');
    if(prepare&&!document.querySelector('[data-docnotice-action="prepare-send"]')){
      prepare.textContent="Nur Entwurf aktualisieren";
      const send=document.createElement("button");
      send.type="button";
      send.className="btn";
      send.dataset.docnoticeAction="prepare-send";
      send.dataset.employeeId=prepare.dataset.employeeId||"";
      send.textContent="Nachweis erstellen & an Mitarbeiter senden";
      const group=document.createElement("div");
      group.className="docnotice-send-actions";
      prepare.parentNode.insertBefore(group,prepare);
      group.append(prepare,send);
    }
    document.querySelectorAll('[data-docsign-action="request"]').forEach(button=>{
      const label=button.disabled?"Erst offene Buchungen korrigieren":"Jetzt an Mitarbeiter senden";
      if(button.textContent!==label)button.textContent=label;
      if(button.dataset.docnoticeEnhanced!=="true")button.dataset.docnoticeEnhanced="true";
    });
  }

  const appRoot=document.getElementById("app");
  if(appRoot)new MutationObserver(()=>decorateManagerDocuments()).observe(appRoot,{childList:true,subtree:true});

  async function requestApproval(submissionId,button){
    button.disabled=true;
    try{
      const result=await call("requestApproval",{submissionId});
      if(result?.submission?.status!=="submitted"||!result?.submission?.approval_requested_at){
        throw new Error("Die Anfrage wurde nicht als offen beim Mitarbeiter gespeichert.");
      }
      toast("Der Mitarbeiter hat jetzt eine sichtbare Aufgabe zur Prüfung und Unterschrift.");
      refreshManagerDocuments();
    }catch(error){toast(error?.message||"Die Anfrage konnte nicht gesendet werden.","error")}
    finally{if(button.isConnected)button.disabled=false}
  }

  async function prepareAndSend(button){
    const employeeId=String(button.dataset.employeeId||document.getElementById("docsign-employee-select")?.value||"");
    const dateFrom=String(document.getElementById("docsign-date-from")?.value||"");
    const dateTo=String(document.getElementById("docsign-date-to")?.value||"");
    if(!employeeId||!dateFrom||!dateTo)return toast("Bitte Mitarbeiter und Zeitraum vollständig auswählen.","error");
    button.disabled=true;
    try{
      const prepared=await call("prepareTimesheet",{employeeId,dateFrom,dateTo});
      const submission=prepared?.submission;
      if(!submission?.id)throw new Error("Der Arbeitszeitnachweis konnte nicht erstellt werden.");
      const openDays=Number(submission.payload?.snapshot?.totals?.openDays||0);
      if(openDays>0){
        toast(`Der Entwurf wurde gespeichert, aber ${openDays} offene oder fehlende Buchung${openDays===1?"":"en"} verhindern die Anfrage.`,"error");
        refreshManagerDocuments();
        return;
      }
      const requested=await call("requestApproval",{submissionId:submission.id});
      if(requested?.submission?.status!=="submitted"||!requested?.submission?.approval_requested_at){
        throw new Error("Der Nachweis wurde erstellt, aber die Mitarbeiteranfrage nicht gespeichert.");
      }
      toast("Nachweis erstellt und dem Mitarbeiter zur Bestätigung und Unterschrift gesendet.");
      refreshManagerDocuments();
    }catch(error){toast(error?.message||"Nachweis konnte nicht erstellt und gesendet werden.","error")}
    finally{if(button.isConnected)button.disabled=false}
  }

  document.addEventListener("click",event=>{
    const inboxButton=event.target.closest('[data-docnotice-action="open-inbox"]');
    if(inboxButton){
      event.preventDefault();
      S.employeeView=pendingRows().length?"documents":"more";
      renderEmployee();
      return;
    }
    const sendButton=event.target.closest('[data-docnotice-action="prepare-send"]');
    if(sendButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      prepareAndSend(sendButton);
      return;
    }
    const requestButton=event.target.closest('[data-docsign-action="request"][data-docnotice-enhanced="true"]');
    if(requestButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      requestApproval(String(requestButton.dataset.submissionId||""),requestButton);
    }
  },true);

  function startPolling(){
    clearInterval(pollTimer);
    pollTimer=setInterval(()=>{
      if(document.visibilityState==="visible"&&employeeSession())ensureInbox(true);
    },8000);
  }
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible"&&employeeSession())ensureInbox(true);
  });
  window.addEventListener("focus",()=>{if(employeeSession())ensureInbox(true)});
  startPolling();
  queueMicrotask(()=>{
    decorateManagerDocuments();
    if(employeeSession())ensureInbox(true);
  });
})();
