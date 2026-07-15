"use strict";
setInterval(()=>document.querySelectorAll("[data-clock]").forEach(n=>n.textContent=berlin().time),1000);
window.addEventListener("popstate",()=>{S.role=routeRole()||S.role;S.session=restore();S.session?loadState():renderLogin()});
async function boot(){renderLoading();try{await loadDirectory();S.role=routeRole()||S.role;S.session=restore();S.session?await loadState():renderLogin()}catch(e){renderError(e.message)}}
boot();
