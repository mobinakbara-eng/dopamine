"use strict";

const DEFAULT_WORKSPACE_SLUG="aora-demo";
const WORKSPACE_STORAGE_KEY="aora:workspace";
function validWorkspaceSlug(value){return/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value||""))}
function selectedWorkspaceSlug(){
  const query=new URLSearchParams(location.search).get("workspace");
  const saved=sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
  const selected=validWorkspaceSlug(query)?query:(validWorkspaceSlug(saved)?saved:DEFAULT_WORKSPACE_SLUG);
  sessionStorage.setItem(WORKSPACE_STORAGE_KEY,selected);
  return selected;
}
const selectedWorkspace=selectedWorkspaceSlug();

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
  const url=new URL(paths[accessRole]||"arbeitnehmer/",document.baseURI);
  url.searchParams.set("workspace",CFG?.slug||selectedWorkspace);
  return url.pathname+url.search;
}
function setAccessRole(accessRole){
  S.accessRole=accessRole;
  S.loginRole=accessRole;
  S.role=sessionRole(accessRole);
}
const initialAccessRole=accessRoleFromPath();
const CFG={
  url:"https://xqgkawskftzurbujrpex.supabase.co",
  publishableKey:"sb_publishable_DA_L16_qVM9opFpQcYz16g_kTBwFpKZ",
  slug:selectedWorkspace,
  accessFunction:"aora-v8-pilot-access",
  workspaceFunction:"aora-v8-pilot-workspace-rules",
  kioskWorkspaceFunction:"aora-v8-pilot-kiosk",
  complianceFunction:"aora-v8-pilot-compliance",
  monitorFunction:"aora-v8-pilot-monitor",
  onboardingFunction:"aora-v8-pilot-onboarding",
  realtimeBroadcastFunction:"aora-v8-pilot-realtime-broadcast",
  realtimeFallbackMs:60000,
  tz:"Europe/Berlin",
  version:"8.1.0-pilot",
  isolated:true
};
const app=document.getElementById("app"),toasts=document.getElementById("toast-root");
const S={
  role:sessionRole(initialAccessRole),
  accessRole:initialAccessRole,
  loginRole:initialAccessRole,
  session:null,directory:null,state:null,revision:0,ruleEngine:null,
  employeeView:"home",adminView:initialAccessRole==="owner"?"owner-overview":"overview",
  locationId:null,selected:null,busy:false,realtimeStatus:"idle"
};
