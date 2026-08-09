import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_ORIGIN="https://dopamine-mobins-projects-4f428afa.vercel.app";
const EXACT=new Set([DEFAULT_ORIGIN,"https://dopamine-blond.vercel.app","https://aora-workforce.vercel.app","https://aora-v8-final.vercel.app","https://aora-v8-hardening.vercel.app"]);
const SUFFIX="-mobins-projects-4f428afa.vercel.app";

class ApiError extends Error{
  status:number;
  code:string;
  details?:unknown;
  constructor(status:number,code:string,message:string,details?:unknown){super(message);this.status=status;this.code=code;this.details=details}
}
const now=()=>new Date().toISOString();
const id=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const clone=<T>(value:T):T=>structuredClone(value);
function currentDateInZone(timeZone:string){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function allowed(origin:string|null){if(!origin||EXACT.has(origin))return true;try{const url=new globalThis.URL(origin);return["localhost","127.0.0.1"].includes(url.hostname)||(url.protocol==="https:"&&url.hostname.endsWith(SUFFIX))}catch{return false}}
function headers(origin:string|null){return{"Access-Control-Allow-Origin":origin&&allowed(origin)?origin:DEFAULT_ORIGIN,"Access-Control-Allow-Headers":"content-type,x-request-id","Access-Control-Allow-Methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store",Vary:"Origin"}}
function ok(requestId:string,data:unknown,origin:string|null,status=200){return new Response(JSON.stringify({request_id:requestId,data,error:null,server_time:now()}),{status,headers:headers(origin)})}
function fail(requestId:string,error:unknown,origin:string|null){const e=error instanceof ApiError?error:new ApiError(500,"internal_error",error instanceof Error?error.message:String(error));return new Response(JSON.stringify({request_id:requestId,data:null,error:{code:e.code,message:e.message,details:e.details||null},server_time:now()}),{status:e.status,headers:headers(origin)})}

async function session(token:string){
  if(token.length!==64)throw new ApiError(401,"invalid_session","Sitzung fehlt.");
  const{data,error}=await db.rpc("validate_demo_session",{p_token:token});
  if(error||!data?.length)throw new ApiError(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  const value=data[0];
  const org=await db.from("organizations").select("id,slug,status").eq("id",value.organization_id).eq("status","active").maybeSingle();
  if(org.error||!org.data)throw new ApiError(403,"organization_inactive","Organisation ist nicht aktiv.");
  let accessRole=value.role;
  let locations:string[]=[];
  if(value.role==="admin"){
    const admin=await db.from("admins").select("payload,deleted_at").eq("organization_id",value.organization_id).eq("id",value.subject_id).maybeSingle();
    if(admin.error||!admin.data||admin.data.deleted_at)throw new ApiError(403,"admin_inactive","Zugang wurde deaktiviert.");
    accessRole=admin.data.payload?.scope==="owner"?"owner":"manager";
    if(accessRole==="owner"){
      const result=await db.from("locations").select("id").eq("organization_id",value.organization_id).eq("active",true).is("deleted_at",null);
      if(result.error)throw result.error;
      locations=(result.data||[]).map((item:any)=>String(item.id));
    }else{
      const result=await db.from("manager_location_access").select("location_id").eq("organization_id",value.organization_id).eq("manager_id",value.subject_id);
      if(result.error)throw result.error;
      locations=(result.data||[]).map((item:any)=>String(item.location_id));
      if(!locations.length)throw new ApiError(403,"location_scope_missing","Für diesen Manager ist kein Standort freigegeben.");
    }
  }else if(value.role==="employee"){
    const employee=await db.from("employees").select("location_id,primary_location_id,active,deleted_at").eq("organization_id",value.organization_id).eq("id",value.subject_id).maybeSingle();
    if(employee.error||!employee.data||!employee.data.active||employee.data.deleted_at)throw new ApiError(403,"employee_inactive","Mitarbeiterkonto ist deaktiviert.");
    const result=await db.from("employee_location_access").select("location_id").eq("organization_id",value.organization_id).eq("employee_id",value.subject_id);
    locations=[...new Set([employee.data.primary_location_id,employee.data.location_id,...(result.data||[]).map((item:any)=>item.location_id)].filter(Boolean).map(String))];
  }else if(value.role==="kiosk")locations=[String(value.location_id||"")];
  return{token,organizationId:String(value.organization_id),subjectId:String(value.subject_id),role:String(value.role),accessRole,locations};
}
function requireRole(ctx:any,roles:string[]){if(!roles.includes(ctx.accessRole))throw new ApiError(403,"forbidden","Keine Berechtigung.")}
function requireLocation(ctx:any,locationId:string){if(!ctx.locations.includes(locationId))throw new ApiError(403,"location_forbidden","Kein Zugriff auf diesen Standort.")}

async function commit(ctx:any,eventType:string,entityType:string,entityId:string,locationId:string|null,change:(state:any)=>void){
  for(let attempt=0;attempt<3;attempt++){
    const snapshot=await db.from("workspace_snapshots").select("state,revision").eq("organization_id",ctx.organizationId).maybeSingle();
    if(snapshot.error||!snapshot.data)throw new ApiError(404,"workspace_missing","Arbeitsbereich fehlt.");
    const state=clone(snapshot.data.state||{});
    for(const key of["shifts","shiftRequests","availabilityRules","notifications","audit"])if(!Array.isArray(state[key]))state[key]=[];
    change(state);
    state.meta={...(state.meta||{}),revision:Number(snapshot.data.revision)+1,updatedAt:now(),variant:"isolated-v8-final"};
    const result=await db.rpc("aora_commit_workspace_state",{p_organization_id:ctx.organizationId,p_expected_revision:Number(snapshot.data.revision),p_state:state,p_actor_role:ctx.accessRole,p_actor_id:ctx.subjectId,p_event_type:eventType,p_event_payload:{entityType,entityId,locationId},p_entity_type:entityType,p_entity_id:entityId,p_location_id:locationId});
    if(!result.error)return{revision:Number(result.data),state};
    if(String(result.error.message).includes("revision_conflict"))continue;
    throw new ApiError(500,"commit_failed",result.error.message);
  }
  throw new ApiError(409,"revision_conflict","Daten wurden parallel geändert.");
}
async function shiftFor(ctx:any,shiftId:string){
  const result=await db.from("shifts").select("*").eq("organization_id",ctx.organizationId).eq("id",shiftId).is("deleted_at",null).maybeSingle();
  if(result.error||!result.data)throw new ApiError(404,"shift_not_found","Schicht wurde nicht gefunden.");
  requireLocation(ctx,String(result.data.location_id));
  return result.data;
}

async function respondShift(ctx:any,body:any){
  requireRole(ctx,["employee"]);
  const shiftId=String(body.shiftId||"");
  const response=String(body.response||"");
  if(!["confirmed","rejected"].includes(response))throw new ApiError(400,"invalid_response","Ungültige Antwort.");
  const shift=await shiftFor(ctx,shiftId);
  if(String(shift.employee_id)!==ctx.subjectId)throw new ApiError(403,"shift_forbidden","Schicht gehört zu einem anderen Mitarbeiter.");
  const requestId=id("shift_request");
  const result=await commit(ctx,"SHIFT_RESPONSE","shift",shiftId,String(shift.location_id),state=>{
    const index=state.shifts.findIndex((item:any)=>String(item.id)===shiftId);
    if(index<0)throw new ApiError(404,"shift_not_found","Schicht wurde nicht gefunden.");
    const current=state.shifts[index];
    if(response==="confirmed")state.shifts[index]={...current,status:"confirmed",confirmedAt:now(),confirmedBy:ctx.subjectId,version:Number(current.version||1)+1};
    else{
      state.shiftRequests.push({id:requestId,shiftId,employeeId:ctx.subjectId,locationId:shift.location_id,requestType:"shift_rejection",status:"pending",reason:String(body.reason||""),createdAt:now(),idempotencyKey:String(body.idempotencyKey||crypto.randomUUID())});
      state.shifts[index]={...current,status:"pending_confirmation",version:Number(current.version||1)+1};
    }
  });
  return{shiftId,response,requestId:response==="rejected"?requestId:null,revision:result.revision};
}
async function requestSwap(ctx:any,body:any){
  requireRole(ctx,["employee"]);
  const shiftId=String(body.shiftId||"");
  const shift=await shiftFor(ctx,shiftId);
  if(String(shift.employee_id)!==ctx.subjectId)throw new ApiError(403,"shift_forbidden","Schicht gehört zu einem anderen Mitarbeiter.");
  const requestId=id("shift_request");
  const result=await commit(ctx,"REQUEST_SHIFT_SWAP","shift_request",requestId,String(shift.location_id),state=>{
    const key=String(body.idempotencyKey||crypto.randomUUID());
    if(state.shiftRequests.some((item:any)=>item.idempotencyKey===key||(item.shiftId===shiftId&&item.employeeId===ctx.subjectId&&item.requestType==="shift_swap"&&item.status==="pending")))throw new ApiError(409,"request_exists","Eine Tauschanfrage ist bereits offen.");
    state.shiftRequests.push({id:requestId,shiftId,employeeId:ctx.subjectId,locationId:shift.location_id,requestType:"shift_swap",status:"pending",reason:String(body.reason||""),targetEmployeeId:body.targetEmployeeId?String(body.targetEmployeeId):null,createdAt:now(),idempotencyKey:key});
  });
  return{requestId,shiftId,revision:result.revision};
}
async function setAvailability(ctx:any,body:any){
  requireRole(ctx,["employee"]);
  const date=String(body.date||"");
  const type=String(body.type||"available");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!["available","unavailable","preferred","limited"].includes(type))throw new ApiError(400,"invalid_availability","Verfügbarkeit ist ungültig.");
  const ruleId=String(body.id||`availability_${ctx.subjectId}_${date}`);
  const locationId=String(body.locationId||ctx.locations[0]||"");
  requireLocation(ctx,locationId);
  const result=await commit(ctx,"SET_AVAILABILITY","availability_rule",ruleId,locationId,state=>{
    const index=state.availabilityRules.findIndex((item:any)=>String(item.id)===ruleId);
    const row={id:ruleId,employeeId:ctx.subjectId,locationId,date,startsOn:date,type,start:body.start||null,end:body.end||null,reason:String(body.reason||""),updatedAt:now(),version:Number(index>=0?state.availabilityRules[index].version||1:0)+1};
    if(index>=0)state.availabilityRules[index]={...state.availabilityRules[index],...row};else state.availabilityRules.push(row);
  });
  return{ruleId,date,type,revision:result.revision};
}
async function claimTask(ctx:any,body:any){
  requireRole(ctx,["employee"]);
  const taskId=String(body.taskId||"");
  const idempotencyKey=String(body.idempotencyKey||crypto.randomUUID());
  const result=await db.rpc("aora_claim_task_atomic",{p_token:ctx.token,p_task_instance_id:taskId,p_idempotency_key:idempotencyKey});
  if(result.error){const conflict=/bereits|not more|verfügbar|already/i.test(result.error.message);throw new ApiError(conflict?409:500,"task_claim_failed",result.error.message)}
  return result.data;
}

async function validateManualAssignees(ctx:any,locationId:string,employeeIds:string[]){
  if(!employeeIds.length)return;
  if(employeeIds.length>50)throw new ApiError(400,"too_many_assignees","Maximal 50 Mitarbeiter können gleichzeitig zugewiesen werden.");
  const employees=await db.from("employees").select("id,location_id,primary_location_id,active,deleted_at").eq("organization_id",ctx.organizationId).in("id",employeeIds);
  if(employees.error)throw new ApiError(500,"database_error",employees.error.message);
  const active=(employees.data||[]).filter((employee:any)=>employee.active&&!employee.deleted_at);
  if(active.length!==employeeIds.length)throw new ApiError(400,"invalid_assignee","Mindestens ein ausgewählter Mitarbeiter ist nicht aktiv oder gehört nicht zur Organisation.");
  const access=await db.from("employee_location_access").select("employee_id,location_id").eq("organization_id",ctx.organizationId).eq("location_id",locationId).in("employee_id",employeeIds);
  if(access.error)throw new ApiError(500,"database_error",access.error.message);
  const explicit=new Set((access.data||[]).map((row:any)=>String(row.employee_id)));
  const invalid=active.filter((employee:any)=>{
    const direct=[employee.location_id,employee.primary_location_id].filter(Boolean).map(String).includes(locationId);
    return !direct&&!explicit.has(String(employee.id));
  });
  if(invalid.length)throw new ApiError(403,"assignee_location_forbidden","Mindestens ein Mitarbeiter ist für diesen Standort nicht freigegeben.",{employeeIds:invalid.map((employee:any)=>String(employee.id))});
}

async function createManualTask(ctx:any,body:any){
  requireRole(ctx,["owner","manager"]);
  const locationId=String(body.locationId||"");
  requireLocation(ctx,locationId);
  const templateId=String(body.templateId||"");
  const employeeIds:string[]=[...new Set<string>((Array.isArray(body.employeeIds)?body.employeeIds:[]).map((value:unknown)=>String(value)).filter(Boolean))];
  const date=String(body.date||new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new ApiError(400,"invalid_task_date","Aufgabendatum ist ungültig.");
  if(!templateId)throw new ApiError(400,"invalid_task","Vorlage fehlt.");

  const dueAt=body.dueAt?new Date(body.dueAt):new Date(`${date}T23:59:00Z`);
  if(Number.isNaN(dueAt.getTime()))throw new ApiError(400,"invalid_deadline","Deadline ist ungültig.");
  if(dueAt.getTime()<Date.now()-60000)throw new ApiError(400,"deadline_in_past","Deadline darf nicht in der Vergangenheit liegen.");

  const template=await db.from("task_templates")
    .select("id,title,description,version,source_version,clockout_policy,location_id,active")
    .eq("organization_id",ctx.organizationId)
    .eq("id",templateId)
    .is("deleted_at",null)
    .maybeSingle();
  if(template.error||!template.data)throw new ApiError(404,"template_not_found","Vorlage wurde nicht gefunden.");
  if(template.data.active===false)throw new ApiError(409,"template_inactive","Diese Vorlage ist deaktiviert.");
  if(template.data.location_id!=null&&String(template.data.location_id)!==locationId)throw new ApiError(403,"template_location_forbidden","Diese Vorlage gehört zu einem anderen Standort.");

  await validateManualAssignees(ctx,locationId,employeeIds);

  const shiftId=body.shiftId?String(body.shiftId):null;
  if(shiftId){
    const shift=await db.from("shifts").select("id,location_id,shift_date,deleted_at").eq("organization_id",ctx.organizationId).eq("id",shiftId).is("deleted_at",null).maybeSingle();
    if(shift.error||!shift.data)throw new ApiError(404,"shift_not_found","Die ausgewählte Schicht wurde nicht gefunden.");
    if(String(shift.data.location_id)!==locationId)throw new ApiError(403,"shift_location_forbidden","Die ausgewählte Schicht gehört zu einem anderen Standort.");
    if(String(shift.data.shift_date)!==date)throw new ApiError(400,"shift_date_mismatch","Die ausgewählte Schicht gehört zu einem anderen Tag.");
  }

  const title=String(body.title||template.data.title||"").trim();
  if(title.length<2||title.length>120)throw new ApiError(400,"invalid_task_title","Der Aufgabentitel muss zwischen 2 und 120 Zeichen lang sein.");
  const instructions=String(body.instructions||"").trim();
  if(instructions.length>2000)throw new ApiError(400,"instructions_too_long","Der Manager-Hinweis darf maximal 2000 Zeichen enthalten.");
  const priority=String(body.priority||"normal");
  if(!["low","normal","high","urgent"].includes(priority))throw new ApiError(400,"invalid_priority","Priorität ist ungültig.");
  const timezone=String(body.timezone||"Europe/Berlin").slice(0,64);
  const templateBlocksClockout=["MANAGER_OVERRIDE","STRICT_BLOCK"].includes(String(template.data.clockout_policy));
  const required=body.required==null?templateBlocksClockout:(body.required===true||String(body.required).toLowerCase()==="true");
  const rawIdempotency=String(body.idempotencyKey||crypto.randomUUID());
  const idempotencyKey=/^[a-zA-Z0-9_-]{8,128}$/.test(rawIdempotency)?rawIdempotency:crypto.randomUUID();
  const scheduledFor=date===currentDateInZone(timezone)?now():new Date(`${date}T12:00:00Z`).toISOString();

  const created:string[]=[];
  const assignees:(string|null)[]=employeeIds.length?employeeIds:[null];
  for(const employeeId of assignees){
    const result=await db.rpc("aora_create_scheduled_task_atomic",{
      p_organization_id:ctx.organizationId,
      p_rule_id:`manual:${idempotencyKey}`,
      p_template_id:templateId,
      p_template_version:Number(template.data.version||template.data.source_version||1),
      p_location_id:locationId,
      p_shift_id:shiftId,
      p_employee_id:employeeId,
      p_scheduled_for:scheduledFor,
      p_due_at:dueAt.toISOString(),
      p_instance_date:date,
      p_blocking_clockout:required,
      p_title:title,
      p_payload:{manual:true,createdBy:ctx.subjectId,title,instructions,priority,required,clockoutPolicy:required?"MANAGER_OVERRIDE":"WARN_ONLY",shiftId,timezone,idempotencyKey}
    });
    if(result.error)throw new ApiError(500,"task_create_failed",result.error.message);
    const taskId=String(result.data?.taskId||"");
    if(taskId&&!created.includes(taskId))created.push(taskId);
  }
  return{taskIds:created,assigneeCount:employeeIds.length,title,priority,required,dueAt:dueAt.toISOString(),idempotencyKey};
}

Deno.serve(async request=>{
  const requestId=request.headers.get("x-request-id")||crypto.randomUUID();
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
  if(request.method!=="POST")return fail(requestId,new ApiError(405,"method_not_allowed","Method not allowed"),origin);
  if(origin&&!allowed(origin))return fail(requestId,new ApiError(403,"origin_forbidden","Origin not allowed"),origin);
  try{
    const body=await request.json();
    const ctx=await session(String(body.token||""));
    let data;
    switch(String(body.action||"")){
      case"respondShift":data=await respondShift(ctx,body);break;
      case"requestSwap":data=await requestSwap(ctx,body);break;
      case"setAvailability":data=await setAvailability(ctx,body);break;
      case"claimTask":data=await claimTask(ctx,body);break;
      case"createManualTask":data=await createManualTask(ctx,body);break;
      default:throw new ApiError(400,"unknown_action","Unbekannte Aktion.");
    }
    return ok(requestId,data,origin);
  }catch(error){return fail(requestId,error,origin)}
});