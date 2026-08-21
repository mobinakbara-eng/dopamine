"use strict";

if(typeof globalThis.productionCall==="function"){
  const productionCallBase=globalThis.productionCall;
  globalThis.productionCall=async function(action,payload={}){
    if(action==="listRequests"&&S.accessRole!=="owner"){
      return{passwordResets:[],supportRequests:[]};
    }
    return productionCallBase(action,payload);
  };
}

(function installDatevOwnerOnlySetupHint(){
  if(globalThis.__aoraDatevOwnerOnlySetupHintInstalled)return;
  globalThis.__aoraDatevOwnerOnlySetupHintInstalled=true;

  function patch(){
    document.querySelectorAll(".datev-hours-card").forEach(card=>{
      const readonly=card.querySelector(".datev-hours-readonly");
      if(!readonly)return;

      const setupItem=[...card.querySelectorAll(".pruefung-alert li")].find(item=>
        String(item.textContent||"").trim()==="DATEV-Zuordnung einmalig einrichten."
      );
      if(setupItem)setupItem.textContent="DATEV-Zuordnung ist noch nicht eingerichtet. Die Einrichtung ist nur im Inhaber-Zugang möglich.";

      if(!card.querySelector(".datev-hours-owner-only-note")){
        const note=document.createElement("div");
        note.className="pruefung-alert datev-hours-owner-only-note";
        note.innerHTML="<strong>Einrichtung durch den Inhaber erforderlich</strong>Beraternummer, Mandantennummer, Lohnart und DATEV-Personalnummern werden im Inhaber-Zugang hinterlegt. Im Manager-Zugang bleiben diese Felder absichtlich schreibgeschützt.";
        readonly.before(note);
      }
    });
  }

  const root=document.getElementById("app");
  if(root)new MutationObserver(patch).observe(root,{childList:true,subtree:true});
  queueMicrotask(patch);
})();
