import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ISSUER="https://token.actions.githubusercontent.com";
const JWKS_URL=ISSUER+"/.well-known/jwks";
const AUDIENCE="aora-staging-ci";
const REPOSITORY="mobinakbara-eng/dopamine";
const REPOSITORY_ID="1044549733";
const REPOSITORY_OWNER="mobinakbara-eng";
const REPOSITORY_OWNER_ID="228580584";
const MERGE_QUEUE_ACTOR="github-merge-queue[bot]";
const MERGE_QUEUE_ACTOR_ID="118344674";
const WORKFLOW_PREFIX=REPOSITORY+"/.github/workflows/aora-v8-pilot-ci.yml@";
const ALLOWED_HEADS=new Set([
  "agent/aora-v8-hardening",
  "agent/aora-kiosk-invite-fix-clean",
  "agent/aora-geofence-duration-fix-v3",
  "agent/aora-unified-production",
  "agent/aora-relational-foundation",
  "agent/aora-access-hardening",
  "agent/aora-workforce-features",
  "agent/aora-zero-cost-release-hardening",
  "agent/aora-manager-task-redesign",
  "agent/aora-team-news-manager-fix"
]);
const ALLOWED_BASES=new Set([
  "agent/aora-v8-final",
  "agent/aora-unified-production",
  "agent/aora-relational-foundation",
  "main"
]);
const ITERATIONS=210000;
const encoder=new TextEncoder();
let jwksCache:any=null;

function response(body:any,status=200){
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer"
  }});
}
function fail(message:string,status=400):never{
  const error:any=new Error(message);error.status=status;throw error;
}
function bearer(req:Request){
  const value=req.headers.get("authorization")||"";
  if(!value.startsWith("Bearer "))fail("missing_oidc_token",401);
  return value.slice(7);
}
function hex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}
function randomHex(size=32){return hex(crypto.getRandomValues(new Uint8Array(size)))}
function fromHex(value:string){return Uint8Array.from(value.match(/.{1,2}/g)||[],part=>parseInt(part,16))}
function base64UrlBytes(value:string){
  const base64=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=");
  const binary=atob(base64);
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
function jwtJson(value:string){
  try{return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)))}catch(_error){fail("invalid_oidc_token",401)}
}
async function sha256(value:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))))}
async function fetchJson(url:string,init:RequestInit,timeoutMs=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{...init,signal:controller.signal});
    const text=await res.text();
    let body:any={};try{body=text?JSON.parse(text):{}}catch(_error){body={message:text}}
    return{ok:res.ok,status:res.status,body};
  }finally{clearTimeout(timer)}
}
async function jwks(){
  if(jwksCache&&jwksCache.expiresAt>Date.now())return jwksCache.keys;
  const result=await fetchJson(JWKS_URL,{headers:{accept:"application/json"}});
  if(!result.ok||!Array.isArray(result.body?.keys))fail("oidc_jwks_unavailable",503);
  jwksCache={keys:result.body.keys,expiresAt:Date.now()+600000};
  return jwksCache.keys;
}
async function verifyOidc(token:string){
  const parts=token.split(".");
  if(parts.length!==3)fail("invalid_oidc_token",401);
  const header=jwtJson(parts[0]);
  const payload=jwtJson(parts[1]);
  if(header.alg!=="RS256"||typeof header.kid!=="string")fail("unsupported_oidc_algorithm",401);
  const jwk=(await jwks()).find((key:any)=>key.kid===header.kid&&key.kty==="RSA");
  if(!jwk)fail("oidc_signing_key_not_found",401);
  const publicKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,base64UrlBytes(parts[2]),encoder.encode(parts[0]+"."+parts[1]));
  if(!valid)fail("invalid_oidc_signature",401);
  const now=Math.floor(Date.now()/1000);
  const audiences=Array.isArray(payload.aud)?payload.aud.map(String):[String(payload.aud||"")];
  if(payload.iss!==ISSUER||!audiences.includes(AUDIENCE))fail("invalid_oidc_claims",401);
  if(typeof payload.exp!=="number"||payload.exp<now-10)fail("expired_oidc_token",401);
  if(typeof payload.nbf==="number"&&payload.nbf>now+10)fail("premature_oidc_token",401);
  return payload;
}
async function claims(req:Request){
  const payload=await verifyOidc(bearer(req));
  if(payload.repository!==REPOSITORY||String(payload.repository_id||"")!==REPOSITORY_ID)fail("repository_not_allowed",403);
  if(!String(payload.workflow_ref||"").startsWith(WORKFLOW_PREFIX))fail("workflow_not_allowed",403);
  const eventName=String(payload.event_name||"");
  const actor=String(payload.actor||"");
  const actorId=String(payload.actor_id||"");
  const ownerActor=actor===REPOSITORY_OWNER&&actorId===REPOSITORY_OWNER_ID;
  const mergeQueueActor=actor===MERGE_QUEUE_ACTOR&&actorId===MERGE_QUEUE_ACTOR_ID;
  if(!ownerActor&&!(["merge_group","push"].includes(eventName)&&mergeQueueActor))fail("actor_not_allowed",403);
  if(eventName==="pull_request"){
    if(!ALLOWED_HEADS.has(String(payload.head_ref||""))||!ALLOWED_BASES.has(String(payload.base_ref||"")))fail("pull_request_not_allowed",403);
  }else if(eventName==="workflow_dispatch"){
    if(!ALLOWED_HEADS.has(String(payload.ref||"").replace(/^refs\/heads\//,"")))fail("dispatch_ref_not_allowed",403);
  }else if(eventName==="push"){
    if(String(payload.ref||"")!=="refs/heads/main"||String(payload.ref_type||"")!=="branch")fail("push_ref_not_allowed",403);
  }else if(eventName==="merge_group"){
    if(String(payload.base_ref||"")!=="main"||!/^refs\/heads\/gh-readonly-queue\/main\//.test(String(payload.ref||"")))fail("merge_group_ref_not_allowed",403);
  }else fail("event_not_allowed",403);
  if(String(payload.runner_environment||"")!=="github-hosted")fail("runner_not_allowed",403);
  const runId=String(payload.run_id||"");
  const runAttempt=String(payload.run_attempt||"");
  if(!/^\d+$/.test(runId)||!/^\d+$/.test(runAttempt))fail("invalid_run_claims",403);
  return{runId,runAttempt,workflowRef:String(payload.workflow_ref),eventName};
}
async function rpc(name:string,body:any){
  if(!SUPABASE_URL||!SERVICE_KEY)fail("server_configuration_missing",500);
  const result=await fetchJson(SUPABASE_URL+"/rest/v1/rpc/"+name,{
    method:"POST",
    headers:{"content-type":"application/json","apikey":SERVICE_KEY,"authorization":"Bearer "+SERVICE_KEY},
    body:JSON.stringify(body)
  },15000);
  if(!result.ok){
    const message=String(result.body?.message||result.body?.code||"rpc_failed").slice(0,500);
    fail(message,result.status>=400&&result.status<600?result.status:500);
  }
  return result.body;
}
function password(){return"Aora-"+randomHex(12)+"-9aZ"}
function email(role:string,runId:string,attempt:string,suffix:string){return("aora-ci-"+role+"-"+runId+"-"+attempt+"-"+suffix+"@example.com").toLowerCase()}
function berlinDate(offsetDays=0){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date(Date.now()+offsetDays*86400000))}
function id(prefix:string,suffix:string){return prefix+"_"+suffix}
async function credential(subjectRole:string,subjectId:string,address:string,plain:string){
  const salt=randomHex(16);
  const key=await crypto.subtle.importKey("raw",encoder.encode(plain),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:fromHex(salt),iterations:ITERATIONS},key,256);
  return{subjectRole,subjectId,email:address,salt,passwordHash:hex(new Uint8Array(bits)),iterations:ITERATIONS};
}
async function bootstrap(identity:any){
  const suffix=randomHex(3);
  const slug=("aora-ci-"+identity.runId+"-"+identity.runAttempt).slice(0,63);
  const now=new Date().toISOString();
  const locationId=id("loc",suffix),ownerId=id("admin_owner",suffix),managerId=id("admin_manager",suffix),employeeId=id("emp",suffix),kioskId=id("kiosk",suffix),invitedManagerId=id("admin_invited",suffix),invitationId=id("invite",crypto.randomUUID());
  const ownerEmail=email("owner",identity.runId,identity.runAttempt,suffix),managerEmail=email("manager",identity.runId,identity.runAttempt,suffix),employeeEmail=email("employee",identity.runId,identity.runAttempt,suffix),invitedEmail=email("invite",identity.runId,identity.runAttempt,suffix);
  const ownerPassword=password(),managerPassword=password(),employeePassword=password(),invitationPassword=password();
  const kioskPin=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
  const invitationToken=randomHex(32),invitationExpiresAt=new Date(Date.now()+7200000).toISOString();
  const emptyKeys=["shifts","leaveRequests","correctionRequests","announcements","notifications","clockRequests","availabilityRules","shiftRequests","checklistTemplates","checklistAssignments","dailyLogs","timesheetPeriods","staffingRequirements","shiftFeedback","shiftTemplates"];
  const state:any={
    company:{name:"Aora CI "+identity.runId,businessType:"QA",billingEmail:ownerEmail,timezone:"Europe/Berlin",language:"de"},
    settings:{timezone:"Europe/Berlin",language:"de",maxDailyMinutes:600,requiredBreakMinutes:30,geofenceRadius:100,clockPolicy:"warn"},
    meta:{variant:"aora-8.1.0-pilot",tenantSource:"github-oidc-ci",revision:1,createdAt:now,ciRunId:identity.runId,ciRunAttempt:Number(identity.runAttempt),workflowRef:identity.workflowRef,eventName:identity.eventName},
    locations:[{
      id:locationId,name:"CI Berlin",city:"Berlin",address:"Teststraße 1",costCenter:"CI",active:true,
      latitude:52.52,longitude:13.405,gps:{lat:52.52,lng:13.405},gpsConfigured:true,geofenceRadius:100,
    }],
    admins:[
      {id:ownerId,name:"CI Owner",email:ownerEmail,role:"Inhaber",scope:"owner",locationIds:[locationId],active:true,status:"active",createdAt:now},
      {id:managerId,name:"CI Manager",email:managerEmail,role:"Manager",scope:"manager",locationIds:[locationId],active:true,status:"active",createdAt:now},
      {id:invitedManagerId,name:"CI Invited Manager",email:invitedEmail,role:"Manager",scope:"manager",locationIds:[locationId],active:true,status:"pending",createdAt:now}
    ],
    employees:[{id:employeeId,name:"CI Employee",email:employeeEmail,role:"Mitarbeiter",locationId,active:true,status:"active",createdAt:now}],
    kioskDevices:[{id:kioskId,name:"CI Kiosk",locationId,active:true,locked:false,createdAt:now}],
    invitations:[{id:invitationId,kind:"manager",name:"CI Invited Manager",email:invitedEmail,status:"pending",subjectId:invitedManagerId,locationIds:[locationId],expiresAt:invitationExpiresAt,createdAt:now,emailStatus:"prepared"}],
    timeEntries:[{id:id("time",suffix),employeeId,locationId,date:berlinDate(-1),start:"08:00",end:"16:30",breakMinutes:30,durationMinutes:480,status:"completed",version:1,ruleSetVersion:1,createdAt:now}],
    audit:[{id:id("audit",crypto.randomUUID()),action:"ci.tenant.bootstrap",actor:"GitHub OIDC",entity:"organization",entityId:slug,createdAt:now}]
  };
  for(const key of emptyKeys)state[key]=[];
  const credentials=await Promise.all([
    credential("admin",ownerId,ownerEmail,ownerPassword),
    credential("admin",managerId,managerEmail,managerPassword),
    credential("employee",employeeId,employeeEmail,employeePassword)
  ]);
  const organizationId=await rpc("aora_bootstrap_ci_tenant",{
    p_slug:slug,p_name:"Aora CI "+identity.runId,p_run_id:identity.runId,p_run_attempt:Number(identity.runAttempt),p_state:state,p_credentials:credentials,
    p_kiosk_id:kioskId,p_kiosk_pin:kioskPin,p_kiosk_name:"CI Kiosk",p_location_id:locationId,p_manager_id:managerId,
    p_invitation_id:invitationId,p_invitation_token_hash:await sha256(invitationToken),p_invitation_expires_at:invitationExpiresAt
  });
  return{
    organizationId,workspaceSlug:slug,managerLocationCount:1,
    owner:{email:ownerEmail,password:ownerPassword},manager:{email:managerEmail,password:managerPassword},employee:{email:employeeEmail,password:employeePassword},
    kiosk:{deviceId:kioskId,pin:kioskPin},
    invitation:{email:invitedEmail,password:invitationPassword,url:"https://aora-v8-hardening.vercel.app/arbeitgeber/?workspace="+encodeURIComponent(slug)+"&invitation="+encodeURIComponent(invitationId)+"&token="+invitationToken}
  };
}
async function cleanup(identity:any,body:any){
  const workspaceSlug=String(body.workspaceSlug||"");
  const cleaned=await rpc("aora_cleanup_ci_tenant",{p_slug:workspaceSlug,p_run_id:identity.runId,p_run_attempt:Number(identity.runAttempt)});
  return{cleaned:Boolean(cleaned),workspaceSlug};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return response({error:"method_not_allowed"},405);
  try{
    const identity=await claims(req);
    const text=await req.text();
    if(encoder.encode(text).byteLength>20000)fail("request_too_large",413);
    const body=text?JSON.parse(text):{};
    if(body.action==="bootstrap")return response(await bootstrap(identity),201);
    if(body.action==="cleanup")return response(await cleanup(identity,body),200);
    return response({error:"unknown_action"},400);
  }catch(error:any){
    console.error("Aora CI bootstrap error",String(error?.message||error));
    return response({error:String(error?.message||error).slice(0,500)},Number(error?.status||500));
  }
});