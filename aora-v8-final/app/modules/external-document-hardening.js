"use strict";

(function hardenExternalDocuments(){
  function stripInternalBranding(html){
    return String(html)
      .replace(/AoraAI\s*Workforce(?:\s*·\s*V8\s*Final)?/gi,"Arbeitgeber")
      .replace(/Aora\s*Arbeitszeitnachweis/gi,"Arbeitszeitnachweis")
      .replace(/Aora\s*Zeiterfassungssystem/gi,"Arbeitszeitnachweis")
      .replace(/Aora\s*Café(?:\s*·\s*V8\s*Final(?:\s*Hardening)?)?/gi,"Arbeitgeber")
      .replace(/Aora\s*Workforce/gi,"Arbeitgeber")
      .replace(/Aora\s*coffee/gi,"Arbeitgeber")
      .replace(/\bAora\b/gi,"Arbeitgeber");
  }

  if(typeof reportsPage==="function"){
    const baseReportsPage=reportsPage;
    reportsPage=function(...args){return stripInternalBranding(baseReportsPage(...args))};
  }

  document.addEventListener("beforeprint",()=>{
    document.querySelectorAll("#aora-print-bundle,.aora-report-preview-shell").forEach(root=>{
      root.querySelectorAll("*").forEach(node=>{
        if(node.children.length===0&&/aora/i.test(node.textContent||""))node.textContent=stripInternalBranding(node.textContent||"");
      });
    });
  });
})();
