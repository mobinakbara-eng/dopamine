"use strict";

(function installTimesheetPreparationSync(){
  const FUNCTION_NAME="aora-v8-timesheet-document-signing-sync";

  function addApprovalsNavigation(){
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

  // This module is loaded after admin.js and before boot.js. Register the
  // navigation synchronously so the first real render already contains
  // Freigaben. Never call renderAdmin before loadState has populated S.state.
  addApprovalsNavigation();

  document.addEventListener("click",async event=>{
    const button=event.target.closest?.('[data-docsign-action="prepare"]');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const dateFrom=String(document.getElementById("docsign-date-from")?.value||"");
    const dateTo=String(document.getElementById("docsign-date-to")?.value||"");
    const employeeId=String(button.dataset.employeeId||document.getElementById("docsign-employee-select")?.value||"");
    if(!employeeId||!dateFrom||!dateTo){
      toast("Bitte Mitarbeiter und vollständigen Zeitraum auswählen.","error");
      return;
    }
    if(dateFrom>dateTo){
      toast("Der Beginn darf nicht nach dem Ende liegen.","error");
      return;
    }
    const currentStatus=String(document.querySelector(".docsign-current .status-chip")?.textContent||"");
    if(/Wartet auf Mitarbeiter/i.test(currentStatus)&&!confirm("Die aktuelle Anfrage an den Mitarbeiter wird durch eine neue Version ersetzt. Fortfahren?"))return;

    button.disabled=true;
    try{
      const result=await request(FUNCTION_NAME,{action:"prepareTimesheet",token:S.session?.token,employeeId,dateFrom,dateTo});
      toast("Aktuelle Arbeitszeiten und alle Tagesbuchungen wurden als neue Version gespeichert.");
      window.dispatchEvent(new CustomEvent("aora:timesheet-prepared",{detail:{submissionId:result?.submission?.id,employeeId,dateFrom,dateTo}}));
      const refresh=document.querySelector('[data-docsign-action="refresh-manager"]');
      if(refresh)refresh.click();else if(typeof renderAdmin==="function")renderAdmin();
    }catch(error){
      toast(error?.message||"Der Arbeitszeitnachweis konnte nicht vorbereitet werden.","error");
    }finally{
      if(button.isConnected)button.disabled=false;
    }
  },true);
})();
