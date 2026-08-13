"use strict";

(function installAoraLegalNavigation(){
  const shield=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 19 5.4v5.3c0 4.5-2.8 8.2-7 10.4-4.2-2.2-7-5.9-7-10.4V5.4L12 2.8Z"/><path d="m8.8 12 2 2 4.4-4.7"/></svg>`;
  let scheduled=false;

  function legalHref(path){
    const origin=typeof CFG!=="undefined"&&CFG.canonicalOrigin?String(CFG.canonicalOrigin):location.origin;
    return new URL(path,origin).href;
  }
  function inlineLinks(){
    return `<div class="aora-legal-links" data-aora-legal-links>
      <a href="${legalHref("/datenschutz/")}">Datenschutz</a>
      <a href="${legalHref("/datenschutzbeauftragter/")}">Datenschutzbeauftragter</a>
    </div>`;
  }
  function syncLegalNavigation(){
    scheduled=false;
    const accessCard=document.querySelector(".access-card");
    if(accessCard&&!accessCard.querySelector("[data-aora-legal-links]"))accessCard.insertAdjacentHTML("beforeend",inlineLinks());

    const sidebar=document.querySelector(".admin-sidebar .sidebar-bottom");
    if(sidebar&&!sidebar.querySelector("[data-aora-sidebar-privacy]")){
      sidebar.insertAdjacentHTML("afterbegin",`<a class="aora-sidebar-privacy-link" data-aora-sidebar-privacy href="${legalHref("/datenschutz/")}">${shield}<span>Datenschutz<small>Kontakt & Betroffenenrechte</small></span></a>`);
    }

    const moreTitle=[...document.querySelectorAll(".employee-page-title h1")].find(node=>node.textContent?.trim()==="Mehr");
    const mobileList=moreTitle?.closest(".employee-main")?.querySelector(".mobile-list");
    if(mobileList&&!mobileList.querySelector("[data-aora-employee-privacy]")){
      mobileList.insertAdjacentHTML("beforeend",`<a class="aora-employee-privacy-card" data-aora-employee-privacy href="${legalHref("/datenschutz/")}"><span class="aora-privacy-icon">${shield}</span><span><strong>Datenschutz & Ihre Rechte</strong><small>Zuständigkeit, Kontakt und Auskunft</small></span><span class="aora-privacy-arrow" aria-hidden="true">›</span></a>`);
    }

    const kiosk=document.querySelector(".kiosk-app,.kiosk-shell");
    if(kiosk&&!document.querySelector("[data-aora-kiosk-privacy]")){
      document.body.insertAdjacentHTML("beforeend",`<a class="aora-kiosk-privacy-link" data-aora-kiosk-privacy href="${legalHref("/datenschutz/")}">Datenschutz</a>`);
    }else if(!kiosk){
      document.querySelector("[data-aora-kiosk-privacy]")?.remove();
    }
  }
  function scheduleSync(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(syncLegalNavigation);
  }

  const target=document.getElementById("app");
  if(target)new MutationObserver(scheduleSync).observe(target,{childList:true,subtree:true});
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",scheduleSync,{once:true}):scheduleSync();
})();
