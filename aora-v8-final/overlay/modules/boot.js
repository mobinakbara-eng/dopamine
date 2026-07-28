"use strict";

let backgroundRefreshRunning=false;

setInterval(()=>{
  document.querySelectorAll("[data-clock]").forEach(node=>{node.textContent=berlin().time});
},1000);

async function refreshWorkspace(){
  if(!S.session||S.busy||backgroundRefreshRunning||document.hidden||!navigator.onLine)return;
  backgroundRefreshRunning=true;
  try{await loadState(true)}finally{backgroundRefreshRunning=false}
}
window.addEventListener("focus",refreshWorkspace);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshWorkspace()});

window.addEventListener("popstate",async()=>{
  const accessRole=accessRoleFromPath();
  setAccessRole(accessRole);
  S.session=restore(accessRole);
  if(S.session)return loadState();
  try{await ensureDirectory(accessRole);renderLogin()}catch(error){renderError(error.message)}
});

function invitationCallback(){
  const params=new URLSearchParams(location.search);
  return{invitationId:params.get("invitation"),token:params.get("token")};
}
function clearInvitationCallback(){
  const url=new URL(location.href);
  url.searchParams.delete("invitation");
  url.searchParams.delete("token");
  url.searchParams.set("workspace",CFG.slug);
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
      clearInvitationCallback();
      renderInvitationSetup(info,callback.invitationId,callback.token);
      return;
    }
    S.session=restore(accessRole);
    if(S.session){await loadState();return}
    await ensureDirectory(accessRole);
    renderLogin();
  }catch(error){
    renderError(error.message);
    reportClientDiagnostic(error.message,error.stack||"","error",{kind:"boot"});
  }
}
boot();
