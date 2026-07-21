"use strict";

async function request(functionName,body){
  const response=await fetch(`${CFG.url}/functions/v1/${functionName}`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body),
    cache:"no-store"
  });
  const text=await response.text();
  let data;
  try{data=text?JSON.parse(text):{}}catch{data={error:text}}
  if(!response.ok){
    const error=new Error(data.error||data.message||`HTTP ${response.status}`);
    error.status=response.status;
    error.data=data;
    throw error;
  }
  return data;
}
async function access(body){return request(CFG.accessFunction,body)}
async function workspace(body){return request(CFG.workspaceFunction,{...body,token:S.session?.token})}

function key(accessRole=S.accessRole){return`aora-v8-final:${accessRole}`}
function save(){if(S.session)sessionStorage.setItem(key(S.accessRole),JSON.stringify(S.session))}
function restore(accessRole=S.accessRole){
  try{return JSON.parse(sessionStorage.getItem(key(accessRole))||"null")}catch{return null}
}
function clearSessions(){
  for(const role of ["owner","manager","employee","kiosk"])sessionStorage.removeItem(key(role));
}
function activateSession(session,fallbackRole){
  S.session=session;
  S.role=session.role;
  S.accessRole=session.accessRole||fallbackRole||session.role;
  S.loginRole=S.accessRole;
  save();
  history.replaceState({},"",accessPath(S.accessRole));
}

async function loadDirectory(){S.directory=await access({action:"directory",workspaceSlug:CFG.slug})}

async function login(loginRole,subjectId,pin){
  const session=await access({action:"login",workspaceSlug:CFG.slug,role:loginRole,subjectId,pin});
  activateSession(session,loginRole);
  await loadState();
}

async function passwordLogin(accessRole,email,password){
  const session=await access({action:"passwordLogin",accessRole,email,password});
  activateSession(session,accessRole);
  await loadState();
}

async function inspectInvitation(invitationId,token){
  return access({action:"inspectInvitation",invitationId,token});
}

async function acceptInvitation(invitationId,token,email,password){
  const session=await access({action:"acceptInvitation",invitationId,token,email,password});
  activateSession(session,session.accessRole);
  await loadState();
}

async function logout(){
  try{S.session?.token&&await access({action:"logout",token:S.session.token})}catch{}
  clearSessions();
  S.session=null;
  S.state=null;
  history.replaceState({},"",accessPath(S.accessRole));
  renderLogin();
}

async function loadState(quiet=false){
  if(!quiet)renderLoading();
  try{
    const data=await workspace({action:"load"});
    S.state=data.state;
    S.revision=data.revision;
    S.session={...S.session,...data.session,token:S.session.token};
    S.role=S.session.role;
    S.accessRole=S.session.accessRole||S.accessRole;
    S.loginRole=S.accessRole;
    const permitted=S.session.locationIds||[];
    S.locationId=(S.locationId&&S.state.locations?.some(location=>location.id===S.locationId))
      ?S.locationId
      :(S.session.locationId||permitted[0]||S.state.locations?.find(location=>location.active!==false)?.id||null);
    save();
    const menuWasOpen=quiet&&document.getElementById("aside")?.classList.contains("open");
    render();
    if(menuWasOpen)document.getElementById("aside")?.classList.add("open");
  }catch(error){
    if(error.status===401||error.status===403){
      clearSessions();
      S.session=null;
      S.state=null;
      renderLogin();
      toast(error.message||"Sitzung abgelaufen.","error");
    }else{
      toast(error.message,"error");
      renderError(error.message);
    }
  }
}

async function apply(event){
  if(S.busy)return;
  S.busy=true;
  try{
    const data=await workspace({action:"apply",event,expectedRevision:S.revision});
    S.state=data.state;
    S.revision=data.revision;
    render();
    return data;
  }catch(error){
    if(error.status===409){
      toast("Daten wurden aktualisiert. Bitte erneut versuchen.","error");
      await loadState(true);
    }else toast(error.message,"error");
    throw error;
  }finally{
    S.busy=false;
  }
}
