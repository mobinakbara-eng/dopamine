import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ISSUER="https://token.actions.githubusercontent.com";
const JWKS_URL=ISSUER+"/.well-known/jwks";
const AUDIENCE="aora-inventory-load-ci";
const REPOSITORY="mobinakbara-eng/dopamine";
const REPOSITORY_ID="1044549733";
const REPOSITORY_OWNER="mobinakbara-eng";
const REPOSITORY_OWNER_ID="228580584";
const WORKFLOW_PREFIX=REPOSITORY+"/.github/workflows/aora-inventory-autopilot-ci.yml@";
const HEAD_BRANCH="agent/aora-inventory-autopilot-v1";
const BASE_BRANCH="agent/aora-inventory-production-ready";
const ITERATIONS=210000;
const encoder=new TextEncoder();
let jwksCache:any=null;

function response(body:any,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}})}
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function bearer(req:Request){const v=req.headers.get("authorization")||"";if(!v.startsWith("Bearer "))fail("missing_oidc_token",401);return v.slice(7)}
function hex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}
function randomHex(size=32){return hex(crypto.getRandomValues(new Uint8Array(size)))}
function fromHex(value:string){return Uint8Array.from(value.match(/.{1,2}/g)||[],part=>parseInt(part,16))}
function base64UrlBytes(value:string){const b=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"="),raw=atob(b);return Uint8Array.from(raw,c=>c.charCodeAt(0))}
function jwtJson(value:string){try{return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)))}catch{fail("invalid_oidc_token",401)}}
async function sha256(value:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))))}
async function fetchJson(url:string,init:RequestInit,timeoutMs=12000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{...init,signal:controller.signal}),text=await res.text();
    let body:any={};try{body=text?JSON.parse(text):{}}catch{body={message:text}}
    return{ok:res.ok,status:res.status,body};
  }finally{clearTimeout(timer)}
}
async function jwks(){
  if(jwksCache&&jwksCache.expiresAt>Date.now())return jwksCache.keys;
  const r=await fetchJson(JWKS_URL,{headers:{accept:"application/json"}},7000);
  if(!r.ok||!Array.isArray(r.body?.keys))fail("oidc_jwks_unavailable",503);
  jwksCache={keys:r.body.keys,expiresAt:Date.now()+600000};return jwksCache.keys;
}
async function verifyOidc(token:string){
  const parts=token.split(".");if(parts.length!==3)fail("invalid_oidc_token",401);
  const header=jwtJson(parts[0]),payload=jwtJson(parts[1]);
  if(header.alg!=="RS256"||typeof header.kid!=="string")fail("unsupported_oidc_algorithm",401);
  const jwk=(await jwks()).find((k:any)=>k.kid===header.kid&&k.kty==="RSA");if(!jwk)fail("oidc_signing_key_not_found",401);
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,base64UrlBytes(parts[2]),encoder.encode(parts[0]+"."+parts[1])))fail("invalid_oidc_signature",401);
  const now=Math.floor(Date.now()/1000),aud=Array.isArray(payload.aud)?payload.aud.map(String):[String(payload.aud||"")];
  if(payload.iss!==ISSUER||!aud.includes(AUDIENCE)||typeof payload.exp!=="number"||payload.exp<now-10)fail("invalid_oidc_claims",401);
  return payload;
}
async function claims(req:Request){
  const p=await verifyOidc(bearer(req));
  if(p.repository!==REPOSITORY||String(p.repository_id||"")!==REPOSITORY_ID)fail("repository_not_allowed",403);
  if(!String(p.workflow_ref||"").startsWith(WORKFLOW_PREFIX))fail("workflow_not_allowed",403);
  if(String(p.actor||"")!==REPOSITORY_OWNER||String(p.actor_id||"")!==REPOSITORY_OWNER_ID)fail("actor_not_allowed",403);
  if(String(p.runner_environment||"")!=="github-hosted")fail("runner_not_allowed",403);
  const eventName=String(p.event_name||"");
  if(eventName==="pull_request"){
    if(String(p.head_ref||"")!==HEAD_BRANCH||String(p.base_ref||"")!==BASE_BRANCH)fail("pull_request_not_allowed",403);
  }else if(eventName==="workflow_dispatch"){
    if(String(p.ref||"")!=="refs/heads/"+HEAD_BRANCH)fail("dispatch_ref_not_allowed",403);
  }else fail("event_not_allowed",403);
  const runId=String(p.run_id||""),runAttempt=String(p.run_attempt||"");
  if(!/^\d+$/.test(runId)||!/^\d+$/.test(runAttempt))fail("invalid_run_claims",403);
  return{runId,runAttempt:Number(runAttempt),eventName,workflowRef:String(p.workflow_ref||"")};
}
async function serviceRequest(path:string,init:RequestInit={}){
  if(!SUPABASE_URL||!SERVICE_KEY)fail("server_configuration_missing",500);
  const headers={apikey:SERVICE_KEY,authorization:"Bearer "+SERVICE_KEY,"content-type":"application/json",...(init.headers||{})};
  const r=await fetchJson(SUPABASE_URL+path,{...init,headers},20000);
  if(!r.ok)fail(String(r.body?.message||r.body?.code||"service_request_failed").slice(0,500),r.status>=400&&r.status<600?r.status:500);
  return r.body;
}
async function rpc(name:string,body:any){return serviceRequest("/rest/v1/rpc/"+name,{method:"POST",body:JSON.stringify(body)})}
async function insert(table:string,rows:any[]){if(!rows.length)return;await serviceRequest("/rest/v1/"+table,{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)})}
function id(prefix:string,suffix:string){return prefix+"_"+suffix}
async function credential(subjectRole:string,subjectId:string,address:string,plain:string){
  const salt=randomHex(16),key=await crypto.subtle.importKey("raw",encoder.encode(plain),"PBKDF2",false,["deriveBits"]),
    bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:fromHex(salt),iterations:ITERATIONS},key,256);
  return{subjectRole,subjectId,email:address,salt,passwordHash:hex(new Uint8Array(bits)),iterations:ITERATIONS};
}
async function bootstrap(identity:any){
  const suffix=randomHex(3),slug=("aora-ci-"+identity.runId+"-"+identity.runAttempt).slice(0,63),now=new Date().toISOString();
  const locationId=id("loc_invload",suffix),ownerId=id("admin_owner_invload",suffix),managerId=id("admin_manager_invload",suffix),
    kioskId=id("kiosk_invload",suffix),invitationId=id("invite_invload",crypto.randomUUID());
  const ownerEmail=`aora-ci-inventory-owner-${identity.runId}-${identity.runAttempt}-${suffix}@example.com`;
  const managerEmail=`aora-ci-inventory-manager-${identity.runId}-${identity.runAttempt}-${suffix}@example.com`;
  const ownerPassword="Aora-"+randomHex(12)+"-9aZ",managerPassword="Aora-"+randomHex(12)+"-9aZ",invitationToken=randomHex(32),kioskPin="654321";
  const state:any={
    company:{name:"Aora Inventory Load "+identity.runId,businessType:"QA",billingEmail:ownerEmail,timezone:"Europe/Berlin",language:"de"},
    settings:{timezone:"Europe/Berlin",language:"de"},
    meta:{variant:"inventory-load-100u",tenantSource:"github-oidc-ci",revision:1,createdAt:now,ciRunId:identity.runId,ciRunAttempt:identity.runAttempt,workflowRef:identity.workflowRef,eventName:identity.eventName},
    locations:[{id:locationId,name:"Inventory Load Berlin",city:"Berlin",address:"QA Teststraße 100",costCenter:"INVLOAD",active:true}],
    admins:[
      {id:ownerId,name:"Inventory Load Owner",email:ownerEmail,role:"Inhaber",scope:"owner",locationIds:[locationId],active:true,status:"active",createdAt:now},
      {id:managerId,name:"Inventory Load Manager",email:managerEmail,role:"Manager",scope:"manager",locationIds:[locationId],active:true,status:"active",createdAt:now}
    ],
    employees:[],kioskDevices:[{id:kioskId,name:"Inventory Load Kiosk",locationId,active:true,locked:false,createdAt:now}],
    invitations:[],shifts:[],leaveRequests:[],correctionRequests:[],announcements:[],notifications:[],clockRequests:[],availabilityRules:[],shiftRequests:[],checklistTemplates:[],checklistAssignments:[],dailyLogs:[],timesheetPeriods:[],staffingRequirements:[],shiftFeedback:[],shiftTemplates:[],timeEntries:[],audit:[]
  };
  const creds=await Promise.all([credential("admin",ownerId,ownerEmail,ownerPassword),credential("admin",managerId,managerEmail,managerPassword)]);
  const orgId=await rpc("aora_bootstrap_ci_tenant",{
    p_slug:slug,p_name:"Aora Inventory Load "+identity.runId,p_run_id:identity.runId,p_run_attempt:identity.runAttempt,p_state:state,p_credentials:creds,
    p_kiosk_id:kioskId,p_kiosk_pin:kioskPin,p_kiosk_name:"Inventory Load Kiosk",p_location_id:locationId,p_manager_id:managerId,
    p_invitation_id:invitationId,p_invitation_token_hash:await sha256(invitationToken),p_invitation_expires_at:new Date(Date.now()+7200000).toISOString()
  });
  const organizationId=String(orgId);
  await insert("feature_flags",[
    {organization_id:organizationId,location_id:locationId,flag_key:"inventory_v1",enabled:true,config:{}},
    {organization_id:organizationId,location_id:locationId,flag_key:"replenishment_suggestions",enabled:true,config:{}}
  ]);
  const sessionTokens=Array.from({length:100},()=>randomHex(32));
  await insert("app_sessions",await Promise.all(sessionTokens.map(async token=>({
    organization_id:organizationId,role:"admin",subject_id:ownerId,location_id:locationId,token_hash:"\\x"+await sha256(token),
    expires_at:new Date(Date.now()+3600000).toISOString()
  }))));
  const item=await rpc("aora_inventory_create_item",{
    p_organization_id:organizationId,p_location_id:locationId,p_sku:"QA-LOAD-100U",p_barcode:"",p_name:"QA Load 100 Users",
    p_base_uom:"piece",p_category:"QA Load",p_reorder_point:0,p_actor_id:ownerId
  });
  const itemId=String(item?.itemId||item?.item_id||"");if(!itemId)fail("inventory_fixture_item_missing",500);
  await rpc("aora_inventory_apply_movement",{
    p_organization_id:organizationId,p_location_id:locationId,p_item_id:itemId,p_kind:"receipt",p_quantity:100,p_reason_code:"qa_load_seed",
    p_reference_type:"qa_load",p_reference_id:identity.runId,p_actor_id:ownerId,p_actor_role:"owner",p_idempotency_key:`qa-load:${identity.runId}:${identity.runAttempt}:seed`
  });
  return{workspaceSlug:slug,organizationId,locationId,itemId,sessionTokens,virtualUsers:100,seedOnHand:100};
}
async function cleanup(identity:any,body:any){
  const expected=("aora-ci-"+identity.runId+"-"+identity.runAttempt).slice(0,63),workspaceSlug=String(body.workspaceSlug||"");
  if(workspaceSlug!==expected)fail("cleanup_scope_invalid",403);
  const cleaned=await rpc("aora_cleanup_ci_tenant",{p_slug:workspaceSlug,p_run_id:identity.runId,p_run_attempt:identity.runAttempt});
  return{cleaned:Boolean(cleaned),workspaceSlug};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return response({error:"method_not_allowed"},405);
  try{
    const identity=await claims(req),text=await req.text();
    if(encoder.encode(text).byteLength>20000)fail("request_too_large",413);
    const body=text?JSON.parse(text):{};
    if(body.action==="bootstrap")return response(await bootstrap(identity),201);
    if(body.action==="cleanup")return response(await cleanup(identity,body),200);
    return response({error:"unknown_action"},400);
  }catch(error:any){
    console.error("Aora inventory load CI bootstrap error",String(error?.message||error));
    return response({error:String(error?.message||error).slice(0,500)},Number(error?.status||500));
  }
});
