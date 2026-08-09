import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_ORIGIN="https://dopamine-mobins-projects-4f428afa.vercel.app";
const PREVIEW_SUFFIX="-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS=new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://aora-workforce.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-v8-hardening.vercel.app"
]);
const MAX_BODY_BYTES=100_000;

class ApiError extends Error{
  status:number;
  code:string;
  details?:unknown;
  constructor(status:number,code:string,message:string,details?:unknown){super(message);this.status=status;this.code=code;this.details=details}
}

function allowedOrigin(origin:string|null){
  if(!origin||EXACT_ORIGINS.has(origin))return true;
  try{
    const parsed=new URL(origin);
    return ["localhost","127.0.0.1"].includes(parsed.hostname)||(parsed.protocol==="https:"&&parsed.hostname.endsWith(PREVIEW_SUFFIX));
  }catch{return false}
}
function cors(origin:string|null){return{
  "Access-Control-Allow-Origin":origin&&allowedOrigin(origin)?origin:DEFAULT_ORIGIN,
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-request-id",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Max-Age":"600",
  Vary:"Origin"
}}
function json(body:unknown,status:number,origin:string|null){return new Response(JSON.stringify(body),{status,headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}})}
function now(){return new Date().toISOString()}
function fail(status:number,code:string,message:string,details?:unknown):never{throw new ApiError(status,code,message,details)}

async function sessionContext(token:string){
  if(token.length!==64)fail(401,"invalid_session","Sitzungstoken fehlt.");
  const{data:sessions,error:sessionError}=await service.rpc("validate_demo_session",{p_token:token});
  if(sessionError||!sessions?.length)fail(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  const session=sessions[0];
  if(session.role!=="admin")fail(403,"manager_required","Nur Manager oder Inhaber dürfen Aufgaben verwalten.");

  const{data:organization,error:organizationError}=await service.from("organizations").select("id,status").eq("id",session.organization_id).eq("status","active").maybeSingle();
  if(organizationError)fail(500,"database_error",organizationError.message);
  if(!organization)fail(403,"organization_inactive","Organisation ist nicht aktiv.");

  const{data:admin,error:adminError}=await service.from("admins")
    .select("id,payload,deleted_at")
    .eq("organization_id",organization.id)
    .eq("id",session.subject_id)
    .is("deleted_at",null)
    .maybeSingle();
  if(adminError)fail(500,"database_error",adminError.message);
  if(!admin||admin.payload?.active===false||String(admin.payload?.status||"")==="revoked")fail(403,"admin_inactive","Administrationszugang wurde deaktiviert.");

  const accessRole=admin.payload?.scope==="owner"?"owner":"manager";
  let allowedLocationIds:string[]=[];
  if(accessRole==="owner"){
    const{data,error}=await service.from("locations").select("id").eq("organization_id",organization.id).eq("active",true).is("deleted_at",null);
    if(error)fail(500,"database_error",error.message);
    allowedLocationIds=(data||[]).map((item:any)=>String(item.id));
  }else{
    const{data,error}=await service.from("manager_location_access").select("location_id").eq("organization_id",organization.id).eq("manager_id",session.subject_id);
    if(error)fail(500,"database_error",error.message);
    allowedLocationIds=(data||[]).map((item:any)=>String(item.location_id));
    if(!allowedLocationIds.length)fail(403,"location_scope_missing","Für diesen Manager ist kein Standort freigegeben.");
  }
  return{session,organizationId:String(organization.id),accessRole,allowedLocationIds};
}

function requireLocation(ctx:any,locationId:string|null){
  if(ctx.accessRole==="owner")return;
  if(!locationId)fail(403,"global_template_forbidden","Nur der Inhaber darf globale Vorlagen verwalten.");
  if(!ctx.allowedLocationIds.includes(String(locationId)))fail(403,"location_forbidden","Für diesen Standort fehlt die Berechtigung.");
}

async function templateAccess(ctx:any,templateId:string){
  if(!templateId)fail(400,"template_required","Vorlage fehlt.");
  const{data,error}=await service.from("task_templates")
    .select("id,location_id,title,active,deleted_at")
    .eq("organization_id",ctx.organizationId)
    .eq("id",templateId)
    .maybeSingle();
  if(error)fail(500,"database_error",error.message);
  if(!data||data.deleted_at)fail(404,"template_not_found","Vorlage wurde nicht gefunden.");
  requireLocation(ctx,data.location_id==null?null:String(data.location_id));
  return data;
}

async function ruleAccess(ctx:any,ruleId:string){
  if(!ruleId)fail(400,"rule_required","Automatisierung fehlt.");
  const{data,error}=await service.from("task_rules")
    .select("id,location_id,template_id,active,deleted_at")
    .eq("organization_id",ctx.organizationId)
    .eq("id",ruleId)
    .maybeSingle();
  if(error)fail(500,"database_error",error.message);
  if(!data||data.deleted_at)fail(404,"rule_not_found","Automatisierung wurde nicht gefunden.");
  requireLocation(ctx,String(data.location_id));
  return data;
}

async function taskAccess(ctx:any,taskId:string){
  if(!taskId)fail(400,"task_required","Aufgabe fehlt.");
  const{data,error}=await service.from("task_instances")
    .select("id,location_id,status,deleted_at")
    .eq("organization_id",ctx.organizationId)
    .eq("id",taskId)
    .maybeSingle();
  if(error)fail(500,"database_error",error.message);
  if(!data||data.deleted_at)fail(404,"task_not_found","Aufgabe wurde nicht gefunden.");
  requireLocation(ctx,String(data.location_id));
  return data;
}

async function setTemplateActive(ctx:any,body:any){
  const templateId=String(body.templateId||"");
  await templateAccess(ctx,templateId);
  const{data,error}=await service.rpc("aora_set_task_template_active",{
    p_organization_id:ctx.organizationId,
    p_template_id:templateId,
    p_active:Boolean(body.active),
    p_actor_id:String(ctx.session.subject_id)
  });
  if(error)fail(error.message?.includes("task_template_not_found")?404:500,"template_state_failed",error.message);
  return data;
}

async function deleteTemplate(ctx:any,body:any){
  const templateId=String(body.templateId||"");
  await templateAccess(ctx,templateId);
  const reason=String(body.reason||"Vom Manager gelöscht").trim().slice(0,500)||"Vom Manager gelöscht";
  const{data,error}=await service.rpc("aora_soft_delete_task_template",{
    p_organization_id:ctx.organizationId,
    p_template_id:templateId,
    p_actor_id:String(ctx.session.subject_id),
    p_reason:reason
  });
  if(error)fail(error.message?.includes("task_template_not_found")?404:500,"template_delete_failed",error.message);
  return data;
}

async function deleteRule(ctx:any,body:any){
  const ruleId=String(body.ruleId||"");
  await ruleAccess(ctx,ruleId);
  const reason=String(body.reason||"Vom Manager gelöscht").trim().slice(0,500)||"Vom Manager gelöscht";
  const{data,error}=await service.rpc("aora_soft_delete_task_rule",{
    p_organization_id:ctx.organizationId,
    p_rule_id:ruleId,
    p_actor_id:String(ctx.session.subject_id),
    p_reason:reason
  });
  if(error)fail(error.message?.includes("task_rule_not_found")?404:500,"rule_delete_failed",error.message);
  return data;
}

async function cancelTask(ctx:any,body:any){
  const taskId=String(body.taskId||"");
  await taskAccess(ctx,taskId);
  const reason=String(body.reason||"Vom Manager abgebrochen").trim().slice(0,500)||"Vom Manager abgebrochen";
  const{data,error}=await service.rpc("aora_cancel_task_instance",{
    p_organization_id:ctx.organizationId,
    p_task_id:taskId,
    p_actor_id:String(ctx.session.subject_id),
    p_reason:reason
  });
  if(error)fail(error.message?.includes("task_instance_not_found")?404:500,"task_cancel_failed",error.message);
  return data;
}

async function deleteTask(ctx:any,body:any){
  const taskId=String(body.taskId||"");
  await taskAccess(ctx,taskId);
  const reason=String(body.reason||"Vom Manager gelöscht").trim().slice(0,500)||"Vom Manager gelöscht";
  const{data,error}=await service.rpc("aora_soft_delete_task_instance",{
    p_organization_id:ctx.organizationId,
    p_task_id:taskId,
    p_actor_id:String(ctx.session.subject_id),
    p_reason:reason
  });
  if(error)fail(error.message?.includes("task_instance_not_found")?404:500,"task_delete_failed",error.message);
  return data;
}

Deno.serve(async request=>{
  const origin=request.headers.get("origin");
  const requestId=request.headers.get("x-request-id")||crypto.randomUUID();
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST")return json({request_id:requestId,data:null,error:{code:"method_not_allowed",message:"Method not allowed"},server_time:now()},405,origin);
  if(origin&&!allowedOrigin(origin))return json({request_id:requestId,data:null,error:{code:"origin_forbidden",message:"Origin not allowed"},server_time:now()},403,origin);
  const length=Number(request.headers.get("content-length")||0);
  if(length>MAX_BODY_BYTES)return json({request_id:requestId,data:null,error:{code:"request_too_large",message:"Request too large"},server_time:now()},413,origin);

  try{
    const body=await request.json();
    const action=String(body.action||"");
    if(action==="health")return json({request_id:requestId,data:{ok:true,service:"aora-v8-task-lifecycle"},error:null,server_time:now()},200,origin);
    const ctx=await sessionContext(String(body.token||""));
    let data:unknown;
    if(action==="setTemplateActive")data=await setTemplateActive(ctx,body);
    else if(action==="deleteTemplate")data=await deleteTemplate(ctx,body);
    else if(action==="deleteRule")data=await deleteRule(ctx,body);
    else if(action==="cancelTask")data=await cancelTask(ctx,body);
    else if(action==="deleteTask")data=await deleteTask(ctx,body);
    else fail(400,"unknown_action","Unbekannte Aktion.");
    return json({request_id:requestId,data,error:null,server_time:now()},200,origin);
  }catch(error){
    const value=error instanceof ApiError?error:new ApiError(500,"internal_error",error instanceof Error?error.message:String(error));
    console.warn("aora-task-lifecycle-rejected",{requestId,status:value.status,code:value.code,message:value.message});
    return json({request_id:requestId,data:null,error:{code:value.code,message:value.message,details:value.details||null},server_time:now()},value.status,origin);
  }
});
