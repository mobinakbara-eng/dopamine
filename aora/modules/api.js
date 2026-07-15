async function request(path,body){const r=await fetch(`${CFG.url}${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}}if(!r.ok){const e=new Error(data.error||data.message||`HTTP ${r.status}`);e.status=r.status;e.data=data;throw e}return data}async function access(body){return request("/functions/v1/aora-access-pages",body)}async function workspace(body){return request("/functions/v1/workspace",{...body,token:S.session?.token})}
function key(role=S.role){return`aora-original:${role}`}function save(){sessionStorage.setItem(key(),JSON.stringify(S.session))}function restore(){try{return JSON.parse(sessionStorage.getItem(key())||"null")}catch{return null}}
async function loadDirectory(){S.directory=await access({action:"directory",workspaceSlug:CFG.slug})}async function login(role,subjectId,pin){S.role=role;S.session=await access({action:"login",workspaceSlug:CFG.slug,role,subjectId,pin});save();history.replaceState({},"",rolePath(role));await loadState()}async function logout(){try{S.session?.token&&await access({action:"logout",token:S.session.token})}catch{}sessionStorage.removeItem(key());S.session=null;S.state=null;renderLogin()}
async function loadState(quiet=false){
  if(!quiet)renderLoading();
  try{
    const d=await workspace({action:"load"});
    S.state=d.state;
    S.revision=d.revision;
    S.session={...S.session,...d.session,token:S.session.token};
    S.locationId=S.session.locationId||S.state.locations?.[0]?.id||"loc_1";
    save();
    const menuWasOpen=quiet&&document.getElementById("aside")?.classList.contains("open");
    render();
    if(menuWasOpen)document.getElementById("aside")?.classList.add("open");
  }catch(e){
    if(e.status===401){
      sessionStorage.removeItem(key());
      S.session=null;
      renderLogin();
      toast("Sitzung abgelaufen.","error");
    }else{
      toast(e.message,"error");
      renderError(e.message);
    }
  }
}
async function apply(event){if(S.busy)return;S.busy=true;try{const d=await workspace({action:"apply",event,expectedRevision:S.revision});S.state=d.state;S.revision=d.revision;render();return d}catch(e){if(e.status===409){toast("Daten wurden aktualisiert. Bitte erneut versuchen.","error");await loadState(true)}else toast(e.message,"error");throw e}finally{S.busy=false}}
