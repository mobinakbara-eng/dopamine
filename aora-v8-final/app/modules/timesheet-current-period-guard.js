"use strict";

(function installTimesheetCurrentPeriodGuard(){
  if(window.__aoraTimesheetCurrentPeriodGuardInstalled)return;
  window.__aoraTimesheetCurrentPeriodGuardInstalled=true;

  const FUNCTION_NAME="aora-v8-timesheet-document-signing";
  let adjusting=false;

  function berlinToday(){
    const parts=new Intl.DateTimeFormat("en-CA",{
      timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(new Date());
    const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function capCurrentPeriod(){
    if(adjusting)return;
    const toInput=document.getElementById("docsign-date-to");
    if(!toInput)return;
    const today=berlinToday();
    toInput.max=today;

    const label=toInput.closest("label");
    if(label&&!label.querySelector(".docsign-period-limit-note")){
      const note=document.createElement("small");
      note.className="docsign-period-limit-note";
      note.style.cssText="display:block;margin-top:8px;color:#777;font-size:12px;line-height:1.45";
      note.textContent="Ein laufender Nachweis endet spätestens heute. Zukünftige Schichten gelten nicht als fehlende Buchungen.";
      label.appendChild(note);
    }

    if(toInput.value&&toInput.value>today){
      adjusting=true;
      toInput.value=today;
      toInput.dispatchEvent(new Event("change",{bubbles:true}));
      queueMicrotask(()=>{adjusting=false});
    }
  }

  function call(action,payload={}){
    return request(FUNCTION_NAME,{action,token:S.session?.token,...payload});
  }

  function refreshManagerDocuments(){
    setTimeout(()=>{
      const refresh=document.querySelector('[data-docsign-action="refresh-manager"]');
      if(refresh)refresh.click();
      else if(typeof renderAdmin==="function"&&S?.session)renderAdmin();
    },40);
  }

  async function prepareAndSendCurrentPeriod(button){
    const employeeId=String(button.dataset.employeeId||document.getElementById("docsign-employee-select")?.value||"");
    const fromInput=document.getElementById("docsign-date-from");
    const toInput=document.getElementById("docsign-date-to");
    const today=berlinToday();
    const dateFrom=String(fromInput?.value||"");
    let dateTo=String(toInput?.value||"");

    if(dateTo>today){
      dateTo=today;
      if(toInput){
        toInput.value=today;
        toInput.dispatchEvent(new Event("change",{bubbles:true}));
      }
    }
    if(!employeeId||!dateFrom||!dateTo)return toast("Bitte Mitarbeiter und Zeitraum vollständig auswählen.","error");
    if(dateFrom>today)return toast("Ein Nachweis für einen zukünftigen Zeitraum kann noch nicht bestätigt werden.","error");
    if(dateFrom>dateTo)return toast("Der Beginn liegt nach dem Ende des verfügbaren Zeitraums.","error");

    button.disabled=true;
    try{
      const prepared=await call("prepareTimesheet",{employeeId,dateFrom,dateTo});
      const submission=prepared?.submission;
      if(!submission?.id)throw new Error("Der Arbeitszeitnachweis konnte nicht erstellt werden.");

      const openDays=Number(submission.payload?.snapshot?.totals?.openDays||0);
      if(openDays>0){
        const rows=submission.payload?.snapshot?.rows||[];
        const openDates=rows.filter(row=>["Offen","Fehlzeit"].includes(String(row?.type||""))).map(row=>row.date).filter(Boolean);
        const detail=openDates.length?` Betroffene Tage: ${openDates.join(", ")}.`:"";
        toast(`Der Entwurf wurde gespeichert, aber ${openDays} tatsächlich offene oder fehlende Buchung${openDays===1?"":"en"} verhindern die Anfrage.${detail}`,"error");
        refreshManagerDocuments();
        return;
      }

      const requested=await call("requestApproval",{submissionId:submission.id});
      if(requested?.submission?.status!=="submitted"||!requested?.submission?.approval_requested_at){
        throw new Error("Der Nachweis wurde erstellt, aber die Mitarbeiteranfrage nicht gespeichert.");
      }
      toast(`Nachweis vom ${dateFrom} bis ${dateTo} wurde dem Mitarbeiter zur Prüfung und Unterschrift gesendet.`);
      refreshManagerDocuments();
    }catch(error){
      toast(error?.message||"Nachweis konnte nicht erstellt und gesendet werden.","error");
    }finally{
      if(button.isConnected)button.disabled=false;
    }
  }

  window.addEventListener("click",event=>{
    const button=event.target?.closest?.('[data-docnotice-action="prepare-send"]');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    prepareAndSendCurrentPeriod(button);
  },true);

  const root=document.getElementById("app");
  if(root)new MutationObserver(()=>capCurrentPeriod()).observe(root,{childList:true,subtree:true});
  document.addEventListener("focusin",event=>{
    if(event.target?.id==="docsign-date-to")capCurrentPeriod();
  });
  queueMicrotask(capCurrentPeriod);
})();
