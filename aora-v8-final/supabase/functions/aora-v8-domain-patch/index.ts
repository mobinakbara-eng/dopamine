import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_ORIGIN="https://dopamine-blond.vercel.app";
const PREVIEW_SUFFIX="-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS=new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-mobins-projects-4f428afa.vercel.app",
  "https://aora-workforce.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-v8-hardening.vercel.app"
]);
const MAX_BODY_BYTES=2_500_000;

class ApiError extends Error{
  status:number;
  code:string;
  details?:unknown;
  constructor(status:number,code:string,message:string,details?:unknown){
    super(message);
    this.status=status;
    this.code=code;
    this.details=details;
  }
}

const now=()=>new Date().toISOString();
const makeId=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const validDate=(value:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||""));
const validTime=(value:unknown)=>/^\d{2}:\d{2}$/.test(String(value||""));
const asInt=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Math.trunc(Number(value)):fallback;
const dateDiff=(from:string,to:string)=>Math.ceil((new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/86400000);

function allowedOrigin(origin:string|null){
  if(!origin||EXACT_ORIGINS.has(origin))return true;
  try{
    const parsed=new URL(origin);
    return ["localhost","127.0.0.1"].includes(parsed.hostname)
      ||(parsed.protocol==="https:"&&parsed.hostname.endsWith(PREVIEW_SUFFIX));
  }catch{return false}
}
function cors(origin:string|null){
  return{
    "Access-Control-Allow-Origin":origin&&allowedOrigin(origin)?origin:DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-request-id",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Access-Control-Max-Age":"600",
    "Vary":"Origin"
  };
}
function success(requestId:string,data:unknown,origin:string|null,status=200){
  return new Response(JSON.stringify({request_id:requestId,data,error:null,server_time:now()}),{
    status,
    headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}
  });
}
function failure(requestId:string,error:unknown,origin:string|null){
  const value=error instanceof ApiError
    ?error
    :new ApiError(500,"internal_error",error instanceof Error?error.message:String(error));
  console.warn("aora-domain-patch-rejected",{requestId,status:value.status,code:value.code,message:value.message});
  return new Response(JSON.stringify({request_id:requestId,data:null,error:{code:value.code,message:value.message,details:value.details||null},server_time:now()}),{
    status:value.status,
    headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}
  });
}
async function one<T=any>(query:PromiseLike<any>,message="Datensatz wurde nicht gefunden."){
  const{data,error}=await query;
  if(error)throw new ApiError(500,"database_error",error.message);
  if(!data)throw new ApiError(404,"not_found",message);
  return data as T;
}

async function sessionFor(token:string){
  if(token.length!==64)throw new ApiError(401,"invalid_session","Sitzungstoken fehlt.");
  const{data,error}=await service.rpc("validate_demo_session",{p_token:token});
  if(error||!data?.length)throw new ApiError(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  const session=data[0];
  const organization=await one(service.from("organizations").select("id,slug,name,status,timezone").eq("id",session.organization_id).eq("status","active").maybeSingle(),"Organisation ist nicht aktiv.");
  let accessRole=String(session.role);
  let locationIds:string[]=[];
  if(session.role==="admin"){
    const admin=await one(service.from("admins").select("id,payload,role,deleted_at").eq("organization_id",organization.id).eq("id",session.subject_id).maybeSingle(),"Administrationszugang wurde deaktiviert.");
    if(admin.deleted_at)throw new ApiError(403,"admin_inactive","Administrationszugang wurde deaktiviert.");
    accessRole=admin.payload?.scope==="owner"?"owner":"manager";
    if(accessRole==="owner"){
      const locations=await service.from("locations").select("id").eq("organization_id",organization.id).eq("active",true).is("deleted_at",null);
      if(locations.error)throw new ApiError(500,"database_error",locations.error.message);
      locationIds=(locations.data||[]).map((item:any)=>String(item.id));
    }else{
      const rows=await service.from("manager_location_access").select("location_id").eq("organization_id",organization.id).eq("manager_id",session.subject_id);
      if(rows.error)throw new ApiError(500,"database_error",rows.error.message);
      locationIds=(rows.data||[]).map((item:any)=>String(item.location_id));
      if(!locationIds.length)throw new ApiError(403,"location_scope_missing","Für diesen Manager ist kein Standortzugriff eingerichtet.");
    }
  }else if(session.role==="employee"){
    const employee=await one(service.from("employees").select("id,location_id,primary_location_id,active,deleted_at").eq("organization_id",organization.id).eq("id",session.subject_id).maybeSingle(),"Mitarbeiter wurde nicht gefunden.");
    if(!employee.active||employee.deleted_at)throw new ApiError(403,"employee_inactive","Mitarbeiterkonto ist deaktiviert.");
    const rows=await service.from("employee_location_access").select("location_id").eq("organization_id",organization.id).eq("employee_id",session.subject_id);
    if(rows.error)throw new ApiError(500,"database_error",rows.error.message);
    locationIds=[...new Set([employee.primary_location_id,employee.location_id,...(rows.data||[]).map((item:any)=>item.location_id)].filter(Boolean).map(String))];
  }else if(session.role==="kiosk"){
    if(!session.location_id)throw new ApiError(403,"kiosk_location_missing","Kiosk-Standort fehlt.");
    locationIds=[String(session.location_id)];
  }
  return{token,session,organization,accessRole,locationIds};
}
function requireRole(ctx:any,roles:string[]){
  if(!roles.includes(ctx.accessRole))throw new ApiError(403,"forbidden","Für diese Aktion fehlt die Berechtigung.");
}
function requireLocation(ctx:any,locationId:string){
  if(!ctx.locationIds.includes(String(locationId)))throw new ApiError(403,"location_forbidden","Kein Zugriff auf diesen Standort.");
}

async function taskAccess(ctx:any,taskId:string){
  const task=await one(service.from("task_instances").select("*,task_templates(*,task_template_items(*)),task_assignments(*),task_answers(*),task_evidence(*)").eq("organization_id",ctx.organization.id).eq("id",taskId).is("deleted_at",null).maybeSingle(),"Aufgabe wurde nicht gefunden.");
  requireLocation(ctx,String(task.location_id));
  if(ctx.accessRole==="employee"&&!task.task_assignments?.some((item:any)=>String(item.employee_id)===String(ctx.session.subject_id))){
    throw new ApiError(403,"task_forbidden","Diese Aufgabe ist nicht dir zugewiesen.");
  }
  return task;
}
async function evidenceUpload(ctx:any,body:any){
  const taskId=String(body.taskId||"");
  const itemId=String(body.itemId||"");
  const mimeType=String(body.mimeType||"");
  const fileSize=asInt(body.fileSize,0);
  const extension=String(body.extension||"bin").replace(/[^a-z0-9]/gi,"").toLowerCase();
  const allowed=new Set(["image/jpeg","image/png","image/webp","application/pdf"]);
  if(!allowed.has(mimeType)||fileSize<=0||fileSize>15*1024*1024)throw new ApiError(400,"invalid_evidence","Dateityp oder Dateigröße ist nicht zulässig.");
  const task=await taskAccess(ctx,taskId);
  const fileId=crypto.randomUUID();
  const path=`${ctx.organization.id}/${task.location_id}/${taskId}/${itemId}/${fileId}.${extension}`;
  const{data,error}=await service.storage.from("checklist-evidence").createSignedUploadUrl(path);
  if(error)throw new ApiError(500,"signed_upload_failed",error.message);
  return{bucket:"checklist-evidence",path,token:data.token,signedUrl:data.signedUrl};
}
async function confirmEvidence(ctx:any,body:any){
  const taskId=String(body.taskId||"");
  const itemId=String(body.itemId||"");
  const path=String(body.path||"");
  const task=await taskAccess(ctx,taskId);
  const prefix=`${ctx.organization.id}/${task.location_id}/${taskId}/${itemId}/`;
  if(!path.startsWith(prefix))throw new ApiError(403,"evidence_path_forbidden","Dateipfad gehört nicht zu dieser Aufgabe.");
  const parts=path.split("/");
  const fileName=parts.pop()||"";
  const folder=parts.join("/");
  const listed=await service.storage.from("checklist-evidence").list(folder,{search:fileName,limit:10});
  if(listed.error||!(listed.data||[]).some((item:any)=>item.name===fileName))throw new ApiError(409,"upload_missing","Der Upload konnte nicht bestätigt werden.");
  const row={
    organization_id:ctx.organization.id,
    location_id:task.location_id,
    task_instance_id:taskId,
    template_item_id:itemId,
    uploaded_by:ctx.session.subject_id,
    storage_path:path,
    mime_type:String(body.mimeType||"application/octet-stream"),
    file_size:asInt(body.fileSize,0),
    sha256:String(body.sha256||""),
    captured_at:body.capturedAt||null
  };
  const inserted=await service.from("task_evidence").insert(row).select("id").single();
  if(inserted.error)throw new ApiError(500,"evidence_confirm_failed",inserted.error.message);
  return{evidenceId:inserted.data.id,path};
}

async function endpointHash(endpoint:string){
  return new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(endpoint)));
}
async function pushSubscribe(ctx:any,body:any){
  requireRole(ctx,["employee"]);
  const subscription=body.subscription||{};
  const endpoint=String(subscription.endpoint||"");
  const p256dh=String(subscription.keys?.p256dh||"");
  const authSecret=String(subscription.keys?.auth||"");
  if(!endpoint.startsWith("https://")||!p256dh||!authSecret)throw new ApiError(400,"invalid_subscription","Push-Abonnement ist ungültig.");
  const row={
    organization_id:ctx.organization.id,
    employee_id:ctx.session.subject_id,
    endpoint,
    endpoint_hash:await endpointHash(endpoint),
    p256dh,
    auth_secret:authSecret,
    user_agent:String(body.userAgent||""),
    active:true,
    last_used_at:now(),
    revoked_at:null
  };
  const saved=await service.from("push_subscriptions").upsert(row,{onConflict:"organization_id,endpoint_hash"});
  if(saved.error)throw new ApiError(500,"push_subscription_failed",saved.error.message);
  return{subscribed:true};
}
async function pushUnsubscribe(ctx:any,body:any){
  requireRole(ctx,["employee"]);
  const endpoint=String(body.endpoint||"");
  if(!endpoint.startsWith("https://"))throw new ApiError(400,"invalid_subscription","Push-Abonnement ist ungültig.");
  const updated=await service.from("push_subscriptions").update({active:false,revoked_at:now()}).eq("organization_id",ctx.organization.id).eq("employee_id",ctx.session.subject_id).eq("endpoint_hash",await endpointHash(endpoint));
  if(updated.error)throw new ApiError(500,"push_unsubscribe_failed",updated.error.message);
  return{subscribed:false};
}

async function managerOverride(ctx:any,body:any){
  requireRole(ctx,["owner","manager"]);
  const employeeId=String(body.employeeId||"");
  const locationId=String(body.locationId||"");
  const reason=String(body.reason||"").trim();
  const taskIds=Array.isArray(body.taskIds)?body.taskIds.map(String):[];
  requireLocation(ctx,locationId);
  if(reason.length<5)throw new ApiError(400,"override_reason_required","Eine Begründung mit mindestens fünf Zeichen ist erforderlich.");
  if(!taskIds.length)throw new ApiError(400,"task_ids_required","Es wurden keine blockierenden Aufgaben angegeben.");
  const tasks=await service.from("task_instances").select("id,status,location_id,version,payload").eq("organization_id",ctx.organization.id).in("id",taskIds).is("deleted_at",null);
  if(tasks.error)throw new ApiError(500,"database_error",tasks.error.message);
  if((tasks.data||[]).length!==taskIds.length)throw new ApiError(404,"task_not_found","Mindestens eine Aufgabe wurde nicht gefunden.");
  if((tasks.data||[]).some((task:any)=>String(task.location_id)!==locationId))throw new ApiError(403,"task_location_forbidden","Mindestens eine Aufgabe gehört zu einem anderen Standort.");
  for(const task of tasks.data||[]){
    const updated=await service.from("task_instances").update({
      status:"waived",
      reviewed_at:now(),
      reviewed_by:ctx.session.subject_id,
      version:Number(task.version||1)+1,
      updated_at:now(),
      payload:{...(task.payload||{}),overrideReason:reason,overrideEmployeeId:employeeId}
    }).eq("organization_id",ctx.organization.id).eq("id",task.id).eq("version",task.version).select("id").maybeSingle();
    if(updated.error||!updated.data)throw new ApiError(409,"version_conflict",updated.error?.message||"Eine Aufgabe wurde parallel geändert.");
  }
  const audit=await service.from("audit_logs").insert({
    organization_id:ctx.organization.id,
    id:makeId("audit"),
    location_id:locationId,
    action:"CLOCKOUT_TASK_OVERRIDE",
    actor:ctx.session.subject_id,
    actor_type:"admin",
    actor_id:ctx.session.subject_id,
    entity:"task_instances",
    entity_type:"task_instances",
    entity_id:taskIds.join(","),
    created_at:now(),
    payload:{employeeId,taskIds,reason},
    metadata:{managerOverride:true}
  });
  if(audit.error)throw new ApiError(500,"audit_failed",audit.error.message);
  return{employeeId,taskIds,overridden:true};
}

function normalizeShift(row:any){
  const payload=row.payload||{};
  return{
    id:row.id,
    locationId:row.location_id??payload.locationId,
    employeeId:row.employee_id??payload.employeeId??null,
    seriesId:row.series_id??payload.seriesId??null,
    date:String(row.shift_date??payload.date??""),
    start:String(row.starts_at??payload.start??"").slice(0,5),
    end:String(row.ends_at??payload.end??"").slice(0,5),
    breakMinutes:Number(row.break_minutes??payload.breakMinutes??0),
    status:row.status??payload.status??"draft"
  };
}
async function evaluateShift(ctx:any,shift:any,existing:any[]){
  if(!shift.employeeId)return;
  const result=await service.rpc("aora_evaluate_shift_rules",{
    p_organization_id:ctx.organization.id,
    p_employee_id:shift.employeeId,
    p_location_id:shift.locationId,
    p_date:shift.date,
    p_start:shift.start,
    p_end:shift.end,
    p_break_minutes:Number(shift.breakMinutes||0),
    p_existing_shifts:existing,
    p_exclude_shift_id:null,
    p_override_reason:null,
    p_actor_type:ctx.accessRole,
    p_actor_id:ctx.session.subject_id
  });
  if(result.error)throw new ApiError(500,"rule_engine_error",result.error.message);
  if(!result.data?.valid){
    throw new ApiError(result.data?.requiresConfirmation?428:422,result.data?.requiresConfirmation?"confirmation_required":"rule_violation",result.data?.requiresConfirmation?"Bestätigung und Begründung erforderlich.":"Die Serie verletzt eine blockierende Arbeitszeitregel.",result.data);
  }
}
async function commitSeries(ctx:any,seriesId:string,locationId:string,generated:any[]){
  for(let attempt=0;attempt<3;attempt++){
    const snapshot=await one(service.from("workspace_snapshots").select("state,revision").eq("organization_id",ctx.organization.id).maybeSingle(),"Arbeitsbereich wurde nicht gefunden.");
    const state=structuredClone(snapshot.state||{});
    if(!Array.isArray(state.shifts))state.shifts=[];
    state.shifts.push(...generated);
    state.meta={...(state.meta||{}),revision:Number(snapshot.revision)+1,updatedAt:now(),variant:"isolated-v8-final"};
    const committed=await service.rpc("aora_commit_workspace_state",{
      p_organization_id:ctx.organization.id,
      p_expected_revision:Number(snapshot.revision),
      p_state:state,
      p_actor_role:ctx.accessRole,
      p_actor_id:ctx.session.subject_id,
      p_event_type:"CREATE_SHIFT_SERIES",
      p_event_payload:{seriesId,locationId,count:generated.length},
      p_entity_type:"shift_series",
      p_entity_id:seriesId,
      p_location_id:locationId
    });
    if(!committed.error)return Number(committed.data);
    if(String(committed.error.message||"").includes("revision_conflict"))continue;
    throw new ApiError(500,"snapshot_commit_failed",committed.error.message);
  }
  throw new ApiError(409,"revision_conflict","Daten wurden parallel geändert. Bitte erneut versuchen.");
}
async function createShiftSeries(ctx:any,body:any){
  requireRole(ctx,["owner","manager"]);
  const input=body.series||{};
  const locationId=String(input.locationId||"");
  const startsOn=String(input.startsOn||"");
  const endsOn=String(input.endsOn||"");
  const recurrence=String(input.recurrence||"weekly");
  const start=String(input.start||"08:00");
  const end=String(input.end||"16:00");
  const employeeId=input.employeeId?String(input.employeeId):null;
  requireLocation(ctx,locationId);
  if(!validDate(startsOn)||!validDate(endsOn)||dateDiff(startsOn,endsOn)<0||dateDiff(startsOn,endsOn)>366)throw new ApiError(400,"invalid_series_range","Serienzeitraum ist ungültig.");
  if(!validTime(start)||!validTime(end)||start===end)throw new ApiError(400,"invalid_shift","Start- oder Endzeit ist ungültig.");
  if(!["daily","weekly","biweekly"].includes(recurrence))throw new ApiError(400,"invalid_recurrence","Wiederholungsmuster wird nicht unterstützt.");
  const seriesId=makeId("series");
  const generated:any[]=[];
  for(let cursor=new Date(`${startsOn}T00:00:00Z`),last=new Date(`${endsOn}T00:00:00Z`);cursor<=last;cursor.setUTCDate(cursor.getUTCDate()+(recurrence==="daily"?1:recurrence==="weekly"?7:14))){
    generated.push({
      ...input,
      id:makeId("shift"),
      seriesId,
      locationId,
      date:cursor.toISOString().slice(0,10),
      start,
      end,
      breakMinutes:Math.max(0,asInt(input.breakMinutes,30)),
      employeeId,
      status:employeeId?"draft":"open",
      version:1,
      createdAt:now(),
      createdBy:ctx.session.subject_id
    });
  }
  let existing:any[]=[];
  if(employeeId){
    const rows=await service.from("shifts").select("*").eq("organization_id",ctx.organization.id).eq("employee_id",employeeId).is("deleted_at",null);
    if(rows.error)throw new ApiError(500,"database_error",rows.error.message);
    existing=(rows.data||[]).map(normalizeShift);
    for(const shift of generated){
      await evaluateShift(ctx,shift,existing);
      existing.push(shift);
    }
  }
  const seriesInsert=await service.from("shift_series").insert({
    organization_id:ctx.organization.id,
    id:seriesId,
    location_id:locationId,
    employee_id:employeeId,
    starts_on:startsOn,
    ends_on:endsOn,
    recurrence,
    recurrence_rule:String(input.recurrenceRule||recurrence),
    start_time:start,
    end_time:end,
    break_minutes:Math.max(0,asInt(input.breakMinutes,30)),
    active:true,
    version:1,
    created_by:ctx.session.subject_id,
    template:input
  });
  if(seriesInsert.error)throw new ApiError(500,"series_create_failed",seriesInsert.error.message);
  try{
    const revision=await commitSeries(ctx,seriesId,locationId,generated);
    return{seriesId,created:generated.length,revision};
  }catch(error){
    await service.from("shift_series").delete().eq("organization_id",ctx.organization.id).eq("id",seriesId);
    throw error;
  }
}

Deno.serve(async(request:Request)=>{
  const requestId=request.headers.get("x-request-id")||crypto.randomUUID();
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST")return failure(requestId,new ApiError(405,"method_not_allowed","Method not allowed"),origin);
  if(origin&&!allowedOrigin(origin))return failure(requestId,new ApiError(403,"origin_forbidden","Origin not allowed"),origin);
  if(Number(request.headers.get("content-length")||0)>MAX_BODY_BYTES)return failure(requestId,new ApiError(413,"request_too_large","Request too large"),origin);
  try{
    const body=await request.json();
    const action=String(body.action||"");
    if(action==="health")return success(requestId,{ok:true,service:"aora-v8-domain-patch"},origin);
    const ctx=await sessionFor(String(body.token||""));
    let data:unknown;
    switch(action){
      case"evidenceUpload":data=await evidenceUpload(ctx,body);break;
      case"confirmEvidence":data=await confirmEvidence(ctx,body);break;
      case"pushSubscribe":data=await pushSubscribe(ctx,body);break;
      case"pushUnsubscribe":data=await pushUnsubscribe(ctx,body);break;
      case"managerOverride":data=await managerOverride(ctx,body);break;
      case"createShiftSeries":data=await createShiftSeries(ctx,body);break;
      default:throw new ApiError(400,"unknown_action","Unbekannte Aktion.");
    }
    return success(requestId,data,origin);
  }catch(error){
    return failure(requestId,error,origin);
  }
});
