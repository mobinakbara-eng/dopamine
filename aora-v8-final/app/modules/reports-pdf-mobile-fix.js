"use strict";

(function installReportPrintFix(){
  function toastMessage(message){
    if(typeof toast==="function"){toast(message);return}
    const root=document.getElementById("toast-root");
    if(!root)return;
    const item=document.createElement("div");
    item.className="toast";
    item.textContent=message;
    root.appendChild(item);
    setTimeout(()=>item.remove(),3000);
  }

  function cleanup(bundle,oldTitle){
    bundle?.remove();
    document.body.classList.remove("aora-report-printing");
    if(oldTitle)document.title=oldTitle;
  }

  function printVisibleReport(){
    const source=document.querySelector(".aora-report-preview-shell .aora-report-sheet, .aora-report-preview-shell .aora-report-overview-card");
    if(!source){toastMessage("Keine PDF-Vorschau verfügbar.");return}

    document.getElementById("aora-print-bundle")?.remove();
    const bundle=document.createElement("div");
    bundle.id="aora-print-bundle";
    const clone=source.cloneNode(true);
    clone.classList.add("print-only");
    bundle.appendChild(clone);
    document.body.appendChild(bundle);
    document.body.classList.add("aora-report-printing");

    const oldTitle=document.title;
    document.title="Arbeitszeitnachweis";
    let cleaned=false;
    const done=()=>{
      if(cleaned)return;
      cleaned=true;
      cleanup(bundle,oldTitle);
      window.removeEventListener("afterprint",done);
    };
    window.addEventListener("afterprint",done,{once:true});

    try{
      window.print();
      setTimeout(done,30000);
    }catch(error){
      done();
      console.error("PDF print failed",error);
      toastMessage("PDF konnte nicht geöffnet werden.");
    }
  }

  document.addEventListener("click",event=>{
    const button=event.target.closest('[data-a="report-print"],[data-a="report-print-all"]');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    printVisibleReport();
  },true);
})();