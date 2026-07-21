"use strict";

function accessRoleFromPath(){
  const query=new URLSearchParams(location.search).get("role");
  const aliases={owner:"owner",inhaber:"owner",manager:"manager",arbeitgeber:"manager",admin:"owner",employee:"employee",arbeitnehmer:"employee",kiosk:"kiosk"};
  if(aliases[query])return aliases[query];
  const match=location.pathname.match(/(?:^|\/)(inhaber|owner|arbeitgeber|manager|admin|arbeitnehmer|employee|kiosk)(?:\/|$)/);
  return aliases[match?.[1]]||"employee";
}
function sessionRole(accessRole){return accessRole==="owner"||accessRole==="manager"?"admin":accessRole}
function accessPath(accessRole){
  const paths={owner:"inhaber/",manager:"arbeitgeber/",employee:"arbeitnehmer/",kiosk:"kiosk/dashboard/"};
  return new URL(paths[accessRole]||"arbeitnehmer/",document.baseURI).pathname;
}
function setAccessRole(accessRole){
  S.accessRole=accessRole;
  S.loginRole=accessRole;
  S.role=sessionRole(accessRole);
}
const initialAccessRole=accessRoleFromPath();
const CFG={
  url:"https://xqgkawskftzurbujrpex.supabase.co",
  slug:"aora-v8-final-demo",
  accessFunction:"aora-v8-final-access",
  workspaceFunction:"aora-v8-final-workspace",
  tz:"Europe/Berlin",
  version:"8.0.5-final",
  isolated:true
};
const app=document.getElementById("app"),toasts=document.getElementById("toast-root");
const S={
  role:sessionRole(initialAccessRole),
  accessRole:initialAccessRole,
  loginRole:initialAccessRole,
  session:null,directory:null,state:null,revision:0,
  employeeView:"home",adminView:initialAccessRole==="owner"?"owner-overview":"overview",
  locationId:null,selected:null,busy:false,magicLinkSent:false
};
