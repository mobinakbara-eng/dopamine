"use strict";

(()=>{
  let fieldId=0;
  const controlSelector="input:not([type='hidden']),select,textarea";
  const buttonLabels={
    close:"Schließen",logout:"Abmelden","admin-menu":"Menü",
    retry:"Erneut versuchen","toggle-kiosk":"Kiosk-Status ändern",
    "archive-location":"Standort archivieren",
  };
  const controlLabels={"loc-select":"Standort"};
  const fallbackLabel=node=>{
    const action=node.dataset?.a||node.dataset?.action||node.getAttribute("name")||"";
    return buttonLabels[action]||action.replace(/[-_]+/g," ").trim();
  };
  const harden=root=>{
    const scope=root?.querySelectorAll?root:document;
    scope.querySelectorAll(".field > label:not([for])").forEach(label=>{
      const control=label.parentElement?.querySelector(controlSelector);
      if(!control)return;
      if(!control.id)control.id=`aora-field-${++fieldId}`;
      label.htmlFor=control.id;
    });
    scope.querySelectorAll(controlSelector).forEach(control=>{
      if(control.hasAttribute("aria-label")||control.hasAttribute("aria-labelledby")||(control.id&&document.querySelector(`label[for="${CSS.escape(control.id)}"]`)))return;
      const key=control.id||control.getAttribute("name")||"";
      const label=controlLabels[key]||key.replace(/[-_]+/g," ").trim();
      if(label)control.setAttribute("aria-label",label);
    });
    scope.querySelectorAll(".modal").forEach(modal=>{
      modal.setAttribute("role","dialog");
      modal.setAttribute("aria-modal","true");
      const heading=modal.querySelector("h1,h2,h3");
      if(heading){
        if(!heading.id)heading.id=`aora-dialog-title-${++fieldId}`;
        modal.setAttribute("aria-labelledby",heading.id);
      }
    });
    scope.querySelectorAll("nav:not([aria-label]):not([aria-labelledby])").forEach(nav=>{
      nav.setAttribute("aria-label",nav.classList.contains("employee-bottom")?"Mitarbeiter Navigation":"Hauptnavigation");
    });
    scope.querySelectorAll("button,a[href],[role='button']").forEach(node=>{
      if(node.hasAttribute("aria-label")||node.hasAttribute("aria-labelledby")||node.textContent?.trim()||node.getAttribute("title"))return;
      const label=fallbackLabel(node);
      if(label)node.setAttribute("aria-label",label);
    });
  };
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)if(node.nodeType===Node.ELEMENT_NODE)harden(node);
  });
  const start=()=>{
    harden(document);
    observer.observe(document.body,{childList:true,subtree:true});
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
  globalThis.aoraHardenAccessibility=harden;
})();

