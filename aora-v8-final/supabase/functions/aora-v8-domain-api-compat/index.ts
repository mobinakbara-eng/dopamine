import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const UPSTREAM=`${SUPABASE_URL}/functions/v1/aora-v8-domain-api`;
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_ORIGIN="https://dopamine-mobins-projects-4f428afa.vercel.app";
const TEAM_PREVIEW_SUFFIX="-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS=new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://aora-workforce.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-v8-hardening.vercel.app"
]);
const MAX_BODY_BYTES=2_500_000;
const TASK_RELATIONS=[
  "*",
  "task_templates!task_instances_organization_id_template_id_fkey(*)",
  "task_assignments!task_assignments_organization_id_task_instance_id_fkey(*)",
  "task_answers!task_answers_task_instance_fkey(*)",
  "task_evidence!task_evidence_organization_id_task_instance_id_fkey(*)"
].join(",");

class CompatError extends Error{
  status:number;
  code:string;
  details?:unknown;
  constructor(status:number,code:string,message:string,details?:unknown){super(message);this.status=status;this.code=code;this.details=details}
}
function allowedOrigin(origin:string|null){
  if(!origin)return true;
  if(EXACT_ORIGINS.has(origin))return true;
  try{
    const parsed=new URL(origin);
    return ["localhost","127.0.0.1"].includes(parsed.hostname)||(parsed.protocol==="https:"&&parsed.hostname.endsWith(TEAM_PREVIEW_SUFFIX));
  }catch{return false}
}
function cors(origin:string|null){
  return{
    "Access-Control-Allow-Origin":origin&&allowedOrigin(origin)?origin:DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-request-id",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Access-Control-Max-Age":"600",
    Vary:"Origin"
  };
}
function json(body:unknown,status:number,origin:string|null){
  return new Response(JSON.stringify(body),{status,headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});
}
function now(){return new Date().toISOString()}
function validDate(value:unknown){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||""))}
function dateDiff(from:string,to:string){return Math.ceil((new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/86400000)}
function fail(status:number,code:string,message:string,details?:unknown):never{throw new CompatError(status,code,message,details)}
function successEnvelope(requestId:string,data:unknown){return{request_id:requestId,data,error:null,version:null,server_time:now()}}
function errorEnvelope(requestId:string,error:unknown){
  const normalized=error instanceof CompatError?error:new CompatError(500,"compat_error",error instanceof Error?error.message:String(error));
  return{status:normalized.status,body:{request_id:requestId,data:null,error:{code:normalized.code,message:normalized.message,details:normalized.details||null},version:null,server_time:now()}};
}

async function sessionContext(token:string){
  if(token.length!==64)fail(401,"invalid_session","Sitzungstoken fehlt.");
  const{data:sessions,error:sessionError}=await service.rpc("validate_demo_session",{p_token:token});
  if(sessionError||!sessions?.length)fail(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  const session=sessions[0];
  const{data:organization,error:organizationError}=await service.from("organizations").select("id,status").eq("id",session.organization_id).eq("status","active").maybeSingle();
  if(organizationError)fail(500,"database_error",organizationError.message);
  if(!organization)fail(403,"organization_inactive","Organisation ist nicht aktiv.");

  let accessRole=String(session.role||"");
  let allowedLocationIds:string[]=[];
  if(session.role==="admin"){
    const{data:admin,error:adminError}=await service.from("admins").select("id,payload").eq("organization_id",organization.id).eq("id",session.subject_id).is("deleted_at",null).maybeSingle();
    if(adminError)fail(500,"database_error",adminError.message);
    if(!admin)fail(403,"admin_inactive","Administrationszugang wurde deaktiviert.");
    accessRole=admin.payload?.scope==="owner"?"owner":"manager";
    if(accessRole==="owner"){
      const{data:locations,error}=await service.from("locations").select("id").eq("organization_id",organization.id).eq("active",true).is("deleted_at",null);
      if(error)fail(500,"database_error",error.message);
      allowedLocationIds=(locations||[]).map((item:any)=>String(item.id));
    }else{
      const{data:locations,error}=await service.from("manager_location_access").select("location_id").eq("organization_id",organization.id).eq("manager_id",session.subject_id);
      if(error)fail(500,"database_error",error.message);
      allowedLocationIds=(locations||[]).map((item:any)=>String(item.location_id));
      if(!allowedLocationIds.length)fail(403,"location_scope_missing","Für diesen Manager ist kein Standort freigegeben.");
    }
  }else if(session.role==="employee"){
    const{data:employee,error:employeeError}=await service.from("employees").select("id,location_id,primary_location_id,active,deleted_at").eq("organization_id",organization.id).eq("id",session.subject_id).maybeSingle();
    if(employeeError)fail(500,"database_error",employeeError.message);
    if(!employee||!employee.active||employee.deleted_at)fail(403,"employee_inactive","Mitarbeiterkonto ist nicht aktiv.");
    const{data:locations,error}=await service.from("employee_location_access").select("location_id").eq("organization_id",organization.id).eq("employee_id",session.subject_id);
    if(error)fail(500,"database_error",error.message);
    allowedLocationIds=[...new Set([employee.primary_location_id,employee.location_id,...(locations||[]).map((item:any)=>item.location_id)].filter(Boolean).map(String))];
  }else if(session.role==="kiosk"){
    if(!session.location_id)fail(403,"kiosk_location_missing","Kiosk-Standort fehlt.");
    allowedLocationIds=[String(session.location_id)];
  }else fail(403,"role_forbidden","Rolle ist für Aufgaben nicht freigegeben.");

  return{session,organizationId:String(organization.id),accessRole,allowedLocationIds};
}
function requireLocation(context:any,locationId:string){
  if(!context.allowedLocationIds.includes(String(locationId)))fail(403,"location_forbidden","Für diesen Standort fehlt die Berechtigung.");
}
async function enrichTaskItems(tasks:any[],organizationId:string){
  if(!tasks.length)return tasks;
  const templateIds=[...new Set(tasks.map((task:any)=>String(task.template_id||"")).filter(Boolean))];
  if(!templateIds.length)return tasks;
  const{data:items,error}=await service.from("task_template_items").select("*").eq("organization_id",organizationId).in("template_id",templateIds).order("position",{ascending:true});
  if(error)fail(500,"database_error",error.message);
  const grouped=new Map<string,any[]>();
  for(const item of items||[]){
    const key=String(item.template_id);
    const list=grouped.get(key)||[];
    list.push(item);
    grouped.set(key,list);
  }
  return tasks.map((task:any)=>({
    ...task,
    task_templates:{...(task.task_templates||{}),task_template_items:grouped.get(String(task.template_id))||[]}
  }));
}
async function scopedTasks(body:any,requestId:string){
  const context=await sessionContext(String(body.token||""));
  const today=new Date().toISOString().slice(0,10);
  const from=String(body.from||today);
  const to=String(body.to||from);
  if(!validDate(from)||!validDate(to)||dateDiff(from,to)<0||dateDiff(from,to)>62)fail(400,"invalid_range","Datumsbereich darf höchstens 62 Tage umfassen.");

  let employeeId=body.employeeId?String(body.employeeId):null;
  let locationId=body.locationId?String(body.locationId):null;
  if(context.accessRole==="employee")employeeId=String(context.session.subject_id);
  if(context.accessRole==="kiosk")locationId=String(context.session.location_id);
  if(locationId)requireLocation(context,locationId);

  let taskIds:string[]|null=null;
  if(employeeId){
    if(context.accessRole==="employee"&&employeeId!==String(context.session.subject_id))fail(403,"employee_forbidden","Zugriff auf andere Mitarbeiter ist nicht erlaubt.");
    const{data:assignments,error}=await service.from("task_assignments").select("task_instance_id").eq("organization_id",context.organizationId).eq("employee_id",employeeId);
    if(error)fail(500,"database_error",error.message);
    taskIds=(assignments||[]).map((item:any)=>String(item.task_instance_id));
    if(!taskIds.length)return successEnvelope(requestId,[]);
  }

  let query=service.from("task_instances")
    .select(TASK_RELATIONS)
    .eq("organization_id",context.organizationId)
    .gte("instance_date",from)
    .lte("instance_date",to)
    .is("deleted_at",null)
    .order("due_at",{ascending:true});
  if(locationId)query=query.eq("location_id",locationId);
  if(taskIds)query=query.in("id",taskIds);
  const{data,error}=await query;
  if(error)fail(500,"database_error",error.message,{hint:error.hint||null,code:error.code||null});

  let scoped=(data||[]).filter((task:any)=>context.accessRole==="owner"||context.allowedLocationIds.includes(String(task.location_id)));
  if(context.accessRole==="employee"){
    const subjectId=String(context.session.subject_id);
    scoped=scoped.map((task:any)=>({
      ...task,
      task_assignments:(task.task_assignments||[]).filter((item:any)=>String(item.employee_id)===subjectId),
      task_answers:(task.task_answers||[]).filter((item:any)=>String(item.employee_id)===subjectId),
      task_evidence:(task.task_evidence||[]).filter((item:any)=>String(item.uploaded_by)===subjectId)
    }));
  }
  return successEnvelope(requestId,await enrichTaskItems(scoped,context.organizationId));
}

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST")return json({error:{code:"method_not_allowed",message:"Method not allowed"}},405,origin);
  if(origin&&!allowedOrigin(origin))return json({error:{code:"origin_forbidden",message:"Origin not allowed"}},403,origin);
  const length=Number(request.headers.get("content-length")||0);
  if(length>MAX_BODY_BYTES)return json({error:{code:"request_too_large",message:"Request too large"}},413,origin);
  const requestId=request.headers.get("x-request-id")||crypto.randomUUID();
  try{
    const text=await request.text();
    if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)return json({error:{code:"request_too_large",message:"Request too large"}},413,origin);
    const body=text?JSON.parse(text):{};
    if(String(body.action||"")==="tasks")return json(await scopedTasks(body,requestId),200,origin);

    const upstream=await fetch(UPSTREAM,{
      method:"POST",
      headers:{"content-type":"application/json","authorization":`Bearer ${SERVICE_KEY}`,"apikey":SERVICE_KEY,"x-request-id":requestId},
      body:JSON.stringify(body)
    });
    const upstreamText=await upstream.text();
    let envelope:any;
    try{envelope=upstreamText?JSON.parse(upstreamText):{}}catch{envelope={error:{code:"invalid_upstream_response",message:upstreamText||"Invalid upstream response"}}}
    return json(envelope,upstream.status,origin);
  }catch(error){
    const failure=errorEnvelope(requestId,error);
    console.warn("aora-domain-compat-rejected",{requestId,status:failure.status,code:failure.body.error.code,message:failure.body.error.message});
    return json(failure.body,failure.status,origin);
  }
});
