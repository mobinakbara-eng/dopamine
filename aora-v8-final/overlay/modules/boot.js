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

function invitationCallback(){
  const params=new URLSearchParams(location.search);
  return{invitationId:params.get("invitation"),token:params.get("token")};
}
function clearInvitationCallback(){
  const url=new URL(location.href);
  url.searchParams.delete("invitation");
  url.searchParams.delete("token");
  history.replaceState({},"",url.pathname+(url.searchParams.toString()?`?${url.searchParams}`:""));
}
async function boot(){
  renderLoading();
  try{
    const accessRole=accessRoleFromPath();
    setAccessRole(accessRole);
    const callback=invitationCallback();
    if(callback.invitationId&&callback.token){
      const info=await inspectInvitation(callback.invitationId,callback.token);
      renderInvitationSetup(info,callback.invitationId,callback.token);
      return;
    }
    await loadDirectory();
    S.session=restore(accessRole);
    S.session?await loadState():renderLogin();
  }catch(error){
    renderError(error.message);
  }
}
boot();
