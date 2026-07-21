"use strict";

let backgroundRefreshRunning=false;

setInterval(()=>{
  document.querySelectorAll("[data-clock]").forEach(node=>{node.textContent=berlin().time});
},1000);

async function refreshWorkspace(){
  if(!S.session||S.busy||backgroundRefreshRunning||document.hidden)return;
  backgroundRefreshRunning=true;
  try{await loadState(true)}finally{backgroundRefreshRunning=false}
}
setInterval(refreshWorkspace,5000);
window.addEventListener("focus",refreshWorkspace);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshWorkspace()});

window.addEventListener("popstate",()=>{
  const accessRole=accessRoleFromPath();
  setAccessRole(accessRole);
  S.session=restore(accessRole);
  S.session?loadState():renderLogin();
});

function emailCallback(){
  const hash=new URLSearchParams(location.hash.replace(/^#/,""));
  const accessToken=hash.get("access_token");
  const invitationId=new URLSearchParams(location.search).get("invitation");
  return{accessToken,invitationId};
}
function clearEmailCallback(){
  const url=new URL(location.href);
  url.hash="";
  url.searchParams.delete("email_login");
  url.searchParams.delete("invitation");
  history.replaceState({}, "", url.pathname+(url.searchParams.toString()?`?${url.searchParams}`:""));
}
async function boot(){
  renderLoading();
  try{
    await loadDirectory();
    const callback=emailCallback();
    if(callback.accessToken){
      await exchangeEmailSession(callback.accessToken,callback.invitationId);
      clearEmailCallback();
      return;
    }
    const accessRole=accessRoleFromPath();
    setAccessRole(accessRole);
    S.session=restore(accessRole);
    S.session?await loadState():renderLogin();
  }catch(error){
    renderError(error.message);
  }
}
boot();
