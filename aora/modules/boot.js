"use strict";

let backgroundRefreshRunning=false;

setInterval(()=>{
  document.querySelectorAll("[data-clock]").forEach((node)=>{
    node.textContent=berlin().time;
  });
},1000);

async function refreshWorkspace(){
  if(!S.session||S.busy||backgroundRefreshRunning||document.hidden)return;
  backgroundRefreshRunning=true;
  try{
    await loadState(true);
  }finally{
    backgroundRefreshRunning=false;
  }
}

setInterval(refreshWorkspace,5000);
window.addEventListener("focus",refreshWorkspace);
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden)refreshWorkspace();
});

window.addEventListener("popstate",()=>{
  S.role=routeRole()||S.role;
  S.session=restore();
  S.session?loadState():renderLogin();
});

async function boot(){
  renderLoading();
  try{
    await loadDirectory();
    S.role=routeRole()||S.role;
    S.session=restore();
    S.session?await loadState():renderLogin();
  }catch(error){
    renderError(error.message);
  }
}

boot();
