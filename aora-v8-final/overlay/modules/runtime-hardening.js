"use strict";

const aoraBaseAccess=access;
access=function(body){return aoraBaseAccess({workspaceSlug:CFG.slug,...body})};

async function compliance(body){
  return request(CFG.complianceFunction,{...body,token:S.session?.token});
}
async function monitor(body){
  return request(CFG.monitorFunction,{...body,token:S.session?.token});
}
async function downloadCompliance(format,filters={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(`${CFG.url}/functions/v1/${CFG.complianceFunction}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"export",format,...filters,token:S.session?.token}),
      cache:"no-store",
      signal:controller.signal
    });
    if(!response.ok){
      let message=`HTTP ${response.status}`;
      try{message=(await response.json()).error||message}catch{}
      throw Object.assign(new Error(message),{status:response.status});
    }
    const blob=await response.blob();
    const disposition=response.headers.get("content-disposition")||"";
    const filename=disposition.match(/filename=\"?([^\";]+)\"?/i)?.[1]||`aora-${format}`;
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=filename;anchor.hidden=true;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return{filename,checksum:response.headers.get("x-aora-export-checksum")};
  }finally{clearTimeout(timeout)}
}

const aoraBaseLoadState=loadState;
loadState=async function(quiet=false){
  const result=await aoraBaseLoadState(quiet);
  if(S.session)connectWorkspaceRealtime().catch(()=>{});
  return result;
};
const aoraBaseLogout=logout;
logout=async function(){
  await disconnectWorkspaceRealtime().catch(()=>{});
  return aoraBaseLogout();
};
