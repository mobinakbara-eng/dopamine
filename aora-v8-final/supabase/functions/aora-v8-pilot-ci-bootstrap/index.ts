import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "jsr:@panva/jose@6.2.4";

const URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service=createClient(URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const ISSUER="https://token.actions.githubusercontent.com";
const AUDIENCE="aora-staging-ci";
const REPOSITORY="mobinakbara-eng/dopamine";
const REPOSITORY_ID="1044549733";
const WORKFLOW_PREFIX=`${REPOSITORY}/.github/workflows/aora-v8-pilot-ci.yml@`;
const ALLOWED_HEAD="agent/aora-v8-hardening";
const ALLOWED_BASE="agent/aora-v8-final";
const JWKS=createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const enc=new TextEncoder();
const ITERATIONS=210000;
const ARRAYS=["shifts","leaveRequests","correctionRequests","announcements","notifications","audit","clockRequests","availabilityRules","shiftRequests","checklistTemplates","checklistAssignments","dailyLogs","timesheetPeriods","staffingRequirements","shiftFeedback","shiftTemplates"];

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}})}
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function bearer(req:Request){const value=req.headers.get("authorization")||"";if(!value.startsWith("Bearer "))fail("missing_oidc_token",401);return value.slice(7)}
function hex(bytes:Uint8Array){return Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("")}
function randomHex(size=32){return hex(crypto.getRandomValues(new Uint8Array(size)))}
async function sha256(value:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value))))}
function fromHex(value:string){return Uint8Array.from(value.match(/.{1,2}/g)||[],item=>parseInt(item,16))}
async function derive(password:string,salt:string){const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);return hex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:fromHex(salt),iterations:ITERATIONS},key,256)))}
function password(){return`Aora-${randomHex(12)}-9aZ`}
function email(role:string,runId:string,attempt:string,suffix:string){return`aora-ci-${role}-${runId}-${attempt}-${suffix}@example.com`.toLowerCase()}
function berlinDate(offsetDays=0){const date=new Date(Date.now()+offsetDays*86400000);return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(date)}
function safeSlug(runId:string,attempt:string){return`aora-ci-${runId}-${attempt}`.slice(0,63)}
function safeId(prefix:string,suffix:string){return`${prefix}_${suffix}`}

async function claims(req:Request){
  const {payload}=await jwtVerify(bearer(req),JWKS,{issuer:ISSUER,audience:AUDIENCE,clockTolerance:5});
  if(payload.repository!==REPOSITORY||String(payload.repository_id||"")!==REPOSITORY_ID)fail("repository_not_allowed",403);
  if(!String(payload.workflow_ref||"").startsWith(WORKFLOW_PREFIX))fail("workflow_not_allowed",403);
  const eventName=String(payload.event_name||"");
  if(eventName==="pull_request"){
    if(String(payload.head_ref||"")!==ALLOWED_HEAD||String(payload.base_ref||"")!==ALLOWED_BASE)fail("pull_request_not_allowed",403);
  }else if(eventName==="workflow_dispatch"){
    if(String(payload.ref||"")!==`refs/heads/${ALLOWED_HEAD}`)fail("dispatch_ref_not_allowed",403);
  }else fail("event_not_allowed",403);
  if(String(payload.runner_environment||"")!=="github-hosted")fail("runner_not_allowed",403);
  const runId=String(payload.run_id||"");
  const runAttempt=String(payload.run_attempt||"");
  if(!/^\d+$/.test(runId)||!/^\d+$/.test(runAttempt))fail("invalid_run_claims",403);
  return{runId,runAttempt,workflowRef:String(payload.workflow_ref),eventName};
}

async function credential(subjectRole:string,subjectId:string,address:string,plain:string){
  const salt=randomHex(16);
  return{subjectRole,subjectId,email:address,salt,passwordHash:await derive(plain,salt),iterations:ITERATIONS};
}

async function bootstrap(identity:{runId:string;runAttempt:string;workflowRef:string;eventName:string}){
  const suffix=randomHex(3),slug=safeSlug(identity.runId,identity.runAttempt),now=new Date().toISOString();
  const locationId=safeId("loc",suffix),ownerId=safeId("admin_owner",suffix),managerId=safeId("admin_manager",suffix),employeeId=safeId("emp",suffix),kioskId=safeId("kiosk",suffix),invitedManagerId=safeId("admin_invited",suffix),invitationId=safeId("invite",crypto.randomUUID());
  const ownerEmail=email("owner",identity.runId,identity.runAttempt,suffix),managerEmail=email("manager",identity.runId,identity.runAttempt,suffix),employeeEmail=email("employee",identity.runId,identity.runAttempt,suffix),invitedEmail=email("invite",identity.runId,identity.runAttempt,suffix);
  const ownerPassword=password(),managerPassword=password(),employeePassword=password(),invitationPassword=password();
  const kioskPin=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
  const invitationToken=randomHex(32),invitationExpiresAt=new Date(Date.now()+2*3600000).toISOString();
  const entryDate=berlinDate(-1),entryId=safeId("time",suffix);
  const state:any={
    company:{name:`Aora CI ${identity.runId}`,businessType:"QA",billingEmail:ownerEmail,timezone:"Europe/Berlin",language:"de"},
    settings:{timezone:"Europe/Berlin",language:"de",maxDailyMinutes:600,requiredBreakMinutes:30,geofenceRadius:100,clockPolicy:"warn"},
    meta:{variant:"aora-8.1.0-pilot",tenantSource:"github-oidc-ci",revision:1,createdAt:now,ciRunId:identity.runId,ciRunAttempt:Number(identity.runAttempt),workflowRef:identity.workflowRef,eventName:identity.eventName},
    locations:[{id:locationId,name:"CI Berlin",city:"Berlin",address:"Teststraße 1",costCenter:"CI",active:true,geofenceRadius:100}],
    admins:[
      {id:ownerId,name:"CI Owner",email:ownerEmail,role:"Inhaber",scope:"owner",locationIds:[locationId],active:true,status:"active",createdAt:now},
      {id:managerId,name:"CI Manager",email:managerEmail,role:"Manager",scope:"manager",locationIds:[locationId],active:true,status:"active",createdAt:now},
      {id:invitedManagerId,name:"CI Invited Manager",email:invitedEmail,role:"Manager",scope:"manager",locationIds:[locationId],active:true,status:"pending",createdAt:now}
    ],
    employees:[{id:employeeId,name:"CI Employee",email:employeeEmail,role:"Mitarbeiter",locationId,active:true,status:"active",createdAt:now}],
    kioskDevices:[{id:kioskId,name:"CI Kiosk",locationId,active:true,locked:false,createdAt:now}],
    invitations:[{id:invitationId,kind:"manager",name:"CI Invited Manager",email:invitedEmail,status:"pending",subjectId:invitedManagerId,locationIds:[locationId],expiresAt:invitationExpiresAt,createdAt:now,emailStatus:"prepared"}],
    timeEntries:[{id:entryId,employeeId,locationId,date:entryDate,start:"08:00",end:"16:30",breakMinutes:30,durationMinutes:480,status:"completed",version:1,ruleSetVersion:1,createdAt:now}],
    ...Object.fromEntries(ARRAYS.map(key=>[key,[]]))
  };
  state.audit=[{id:safeId("audit",crypto.randomUUID()),action:"ci.tenant.bootstrap",actor:"GitHub OIDC",entity:"organization",entityId:slug,createdAt:now}];
  const credentials=await Promise.all([
    credential("admin",ownerId,ownerEmail,ownerPassword),
    credential("admin",managerId,managerEmail,managerPassword),
    credential("employee",employeeId,employeeEmail,employeePassword)
  ]);
  const {data:organizationId,error}=await service.rpc("aora_bootstrap_ci_tenant",{
    p_slug:slug,p_name:`Aora CI ${identity.runId}`,p_run_id:identity.runId,p_run_attempt:Number(identity.runAttempt),p_state:state,p_credentials:credentials,
    p_kiosk_id:kioskId,p_kiosk_pin:kioskPin,p_kiosk_name:"CI Kiosk",p_location_id:locationId,p_manager_id:managerId,
    p_invitation_id:invitationId,p_invitation_token_hash:await sha256(invitationToken),p_invitation_expires_at:invitationExpiresAt
  });
  if(error)throw error;
  const invitationUrl=`https://aora-v8-hardening.vercel.app/arbeitgeber/?workspace=${encodeURIComponent(slug)}&invitation=${encodeURIComponent(invitationId)}&token=${invitationToken}`;
  return{
    organizationId,workspaceSlug:slug,managerLocationCount:1,
    owner:{email:ownerEmail,password:ownerPassword},manager:{email:managerEmail,password:managerPassword},employee:{email:employeeEmail,password:employeePassword},
    kiosk:{deviceId:kioskId,pin:kioskPin},invitation:{email:invitedEmail,password:invitationPassword,url:invitationUrl}
  };
}

async function cleanup(identity:{runId:string;runAttempt:string},body:any){
  const slug=String(body.workspaceSlug||"");
  const {data,error}=await service.rpc("aora_cleanup_ci_tenant",{p_slug:slug,p_run_id:identity.runId,p_run_attempt:Number(identity.runAttempt)});
  if(error)throw error;
  return{cleaned:Boolean(data),workspaceSlug:slug};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  try{
    const identity=await claims(req);
    const text=await req.text();if(new TextEncoder().encode(text).byteLength>20000)fail("request_too_large",413);
    const body=text?JSON.parse(text):{};
    if(body.action==="bootstrap")return json(await bootstrap(identity),201);
    if(body.action==="cleanup")return json(await cleanup(identity,body),200);
    return json({error:"unknown_action"},400);
  }catch(error:any){
    console.error("Aora CI bootstrap error",error?.code||error?.message||String(error));
    return json({error:error instanceof Error?error.message:String(error)},Number(error?.status||500));
  }
});
