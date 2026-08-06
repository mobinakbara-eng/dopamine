"use strict";

let backgroundRefreshRunning=false;

setInterval(()=>{
  document.querySelectorAll("[data-clock]").forEach(node=>{node.textContent=berlin().time});
  document.querySelectorAll("[data-clock-request-expires]").forEach(node=>{
    const seconds=Math.max(0,Math.ceil((new Date(node.dataset.clockRequestExpires).getTime()-Date.now())/1000));
    node.textContent=seconds>0?`noch ${seconds} Sekunden gültig`:"abgelaufen";
    const approve=node.closest("[data-clock-request-panel]")?.querySelector('[data-a="clock-approve"]');
    if(approve)approve.disabled=seconds===0;
  });
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
function redirectInvitationToCanonicalOrigin(callback){
  if(!callback.invitationId||!callback.token||location.origin===CFG.canonicalOrigin)return false;
  if(location.protocol!=="https:"||!location.hostname.endsWith(".vercel.app"))return false;
  const target=new URL(location.href);
  const canonical=new URL(CFG.canonicalOrigin);
  target.protocol=canonical.protocol;
  target.host=canonical.host;
  location.replace(target.toString());
  return true;
}
function authenticatedSession(preferredRole){
  const roles=[preferredRole,"owner","manager","employee","kiosk"].filter((role,index,list)=>role&&list.indexOf(role)===index);
  for(const role of roles){
    const session=restore(role);
    if(session?.token)return{role:session.accessRole||role,session};
  }
  return null;
}
function clearInvitationCallback(accessRole=S.accessRole){
  history.replaceState({},"",accessPath(accessRole));
}
async function boot(){
  renderLoading();
  try{
    const pathRole=accessRoleFromPath();
    const callback=invitationCallback();
    const recovered=callback.invitationId&&callback.token?authenticatedSession(pathRole):null;
    if(recovered){
      setAccessRole(recovered.role);
      S.session=recovered.session;
      clearInvitationCallback(recovered.role);
      await loadState();
      return;
    }
    setAccessRole(pathRole);
    S.session=restore(pathRole);
    if(redirectInvitationToCanonicalOrigin(callback))return;
    if(callback.invitationId&&callback.token){
      const info=await inspectInvitation(callback.invitationId,callback.token);
      renderInvitationSetup(info,callback.invitationId,callback.token);
      return;
    }
    if(S.session){await loadState();return}
    if(pathRole==="kiosk"&&typeof restoreOfflineKioskSession==="function"){
      await ensureDirectory(pathRole);
      const restored=await restoreOfflineKioskSession();
      if(restored){
        activateSession(restored,"kiosk");
        await loadState();
        return;
      }
    }
    await ensureDirectory(pathRole);
    renderLogin();
  }catch(error){
    renderError(error.message);
    reportClientDiagnostic(error.message,error.stack||"","error",{kind:"boot"});
  }
}
boot();
