import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const WINDOW_PAST_MS=10*60*1000;
const WINDOW_FUTURE_MS=5*60*1000;
const PAGE_SIZE=250;
const RULE_CONCURRENCY=8;
const nowIso=()=>new Date().toISOString();
const id=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const asTime=(value:unknown)=>/^\d{2}:\d{2}$/.test(String(value||""))?String(value):null;
const minutes=(value:unknown)=>Number.isFinite(Number(value))?Math.trunc(Number(value)):0;
const weekdayKeys=["sun","mon","tue","wed","thu","fri","sat"];
const uuid=(value:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""))?String(value):null;

async function secret(name:string){const{data,error}=await db.rpc("aora_get_runtime_secret",{p_name:name});if(error)throw new Error(`secret:${name}`);return String(data||"")}
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}})}
function localParts(date:Date,timeZone:string){const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(date);const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));return{date:`${m.year}-${m.month}-${m.day}`,weekday:String(m.weekday||"").slice(0,3).toLowerCase(),year:Number(m.year),month:Number(m.month),day:Number(m.day),hour:Number(m.hour),minute:Number(m.minute),second:Number(m.second)}}
function zoneOffsetMs(date:Date,timeZone:string){const p=localParts(date,timeZone);return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-date.getTime()}
function zonedDateTime(dateText:string,timeText:string,timeZone:string){const[y,m,d]=dateText.split("-").map(Number),[h,min]=timeText.split(":").map(Number);let stamp=Date.UTC(y,m-1,d,h,min,0);for(let i=0;i<3;i++)stamp=Date.UTC(y,m-1,d,h,min,0)-zoneOffsetMs(new Date(stamp),timeZone);return new Date(stamp)}
function addDays(dateText:string,days:number){const date=new Date(`${dateText}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
function inWindow(candidate:Date,runAt:Date){return candidate.getTime()>=runAt.getTime()-WINDOW_PAST_MS&&candidate.getTime()<=runAt.getTime()+WINDOW_FUTURE_MS}
function statusEligible(status:string){return["published","confirmed","pending_confirmation"].includes(status)}
function normalizedShift(row:any){const p=row.payload||{};return{id:String(row.id),employeeId:row.employee_id??p.employeeId??null,locationId:String(row.location_id??p.locationId??""),date:String(row.shift_date??p.date??""),start:String(row.starts_at??p.start??"").slice(0,5),end:String(row.ends_at??p.end??"").slice(0,5),status:String(row.status??p.status??"draft")}}
function shiftBounds(shift:any,timeZone:string){const start=zonedDateTime(shift.date,shift.start,timeZone);let end=zonedDateTime(shift.date,shift.end,timeZone);if(end<=start)end=zonedDateTime(addDays(shift.date,1),shift.end,timeZone);return{start,end}}

function ruleCandidates(rule:any,location:any,shifts:any[],runAt:Date){
  const timeZone=String(location.timezone||"Europe/Berlin"),candidates:{scheduledFor:Date,shiftId:string|null,localDate:string}[]=[],config=rule.trigger_config||{},localToday=localParts(runAt,timeZone).date,dates=[addDays(localToday,-1),localToday,addDays(localToday,1)];
  if(rule.trigger_type==="fixed_time"){
    const time=asTime(config.time);if(!time)return candidates;
    for(const date of dates){const candidate=zonedDateTime(date,time,timeZone),key=localParts(candidate,timeZone).weekday,allowed=Array.isArray(config.weekdays)?config.weekdays.map((x:any)=>String(x).toLowerCase()):null;if((!allowed||!allowed.length||allowed.includes(key)||allowed.includes(String(weekdayKeys.indexOf(key))))&&inWindow(candidate,runAt))candidates.push({scheduledFor:candidate,shiftId:null,localDate:date})}
  }
  if(["shift_start","shift_end","before_shift_end","after_shift_start"].includes(rule.trigger_type)){
    for(const shift of shifts.filter(s=>s.locationId===rule.location_id&&s.employeeId&&statusEligible(s.status))){const bounds=shiftBounds(shift,timeZone);let candidate=rule.trigger_type.includes("end")?bounds.end:bounds.start;const offset=Math.abs(minutes(config.minutes??rule.due_offset_minutes));if(rule.trigger_type==="before_shift_end")candidate=new Date(bounds.end.getTime()-offset*60000);if(rule.trigger_type==="after_shift_start")candidate=new Date(bounds.start.getTime()+offset*60000);if(inWindow(candidate,runAt))candidates.push({scheduledFor:candidate,shiftId:shift.id,localDate:localParts(candidate,timeZone).date})}
  }
  if(["location_open","location_close"].includes(rule.trigger_type)){
    const hours=location.payload?.openingHours||{};
    for(const date of dates){const weekday=localParts(zonedDateTime(date,"12:00",timeZone),timeZone).weekday,entry=hours[weekday]||hours[String(weekdayKeys.indexOf(weekday))]||null,value=entry&&(rule.trigger_type==="location_open"?(entry.open||entry.start):(entry.close||entry.end)),time=asTime(value);if(!time)continue;const candidate=zonedDateTime(date,time,timeZone);if(inWindow(candidate,runAt))candidates.push({scheduledFor:candidate,shiftId:null,localDate:date})}
  }
  return candidates;
}

const employeeCache=new Map<string,Promise<any[]>>();
async function eligibleEmployees(organizationId:string,locationId:string){
  const key=`${organizationId}:${locationId}`;
  if(!employeeCache.has(key))employeeCache.set(key,(async()=>{const[{data:employees,error},{data:access,error:ae}]=await Promise.all([db.from("employees").select("id,name,role,role_title,location_id,primary_location_id,active,deleted_at").eq("organization_id",organizationId).eq("active",true).is("deleted_at",null),db.from("employee_location_access").select("employee_id").eq("organization_id",organizationId).eq("location_id",locationId)]);if(error||ae)throw new Error("employee_context_failed");const explicit=new Set((access||[]).map((r:any)=>String(r.employee_id)));return(employees||[]).filter((e:any)=>[e.primary_location_id,e.location_id].filter(Boolean).map(String).includes(locationId)||explicit.has(String(e.id)))})());
  return employeeCache.get(key)!;
}

async function leastRecentlyAssigned(orgId:string,locationId:string,ruleId:string,onShift:any[]){if(!ruleId||onShift.length<2)return onShift;const{data:instances,error}=await db.from("task_instances").select("id,scheduled_for").eq("organization_id",orgId).eq("location_id",locationId).eq("rule_id",ruleId).is("deleted_at",null).order("scheduled_for",{ascending:false}).limit(200);if(error)throw new Error("recent_tasks_failed");const ids=(instances||[]).map((x:any)=>String(x.id));if(!ids.length)return onShift;const{data:assignments,error:ae}=await db.from("task_assignments").select("employee_id,assigned_at,task_instance_id").eq("organization_id",orgId).in("task_instance_id",ids);if(ae)throw new Error("recent_assignments_failed");const latest=new Map<string,number>();for(const a of assignments||[]){const eid=String(a.employee_id||""),stamp=new Date(a.assigned_at||0).getTime();if(eid&&stamp>(latest.get(eid)||0))latest.set(eid,stamp)}return[...onShift].sort((a:any,b:any)=>(latest.get(String(a.id))||0)-(latest.get(String(b.id))||0)||String(a.id).localeCompare(String(b.id)))}

async function employeesAt(orgId:string,locationId:string,scheduledFor:Date,shifts:any[],strategy:string,config:any,timeZone:string){
  const eligible=await eligibleEmployees(orgId,locationId),onShiftIds=new Set(shifts.filter(s=>{if(s.locationId!==locationId||!s.employeeId||!statusEligible(s.status))return false;const b=shiftBounds(s,timeZone);return scheduledFor>=b.start&&scheduledFor<=b.end}).map(s=>String(s.employeeId)));
  if(strategy==="specific_employee")return eligible.filter((e:any)=>String(e.id)===String(config.employeeId)).map((e:any)=>String(e.id));
  if(strategy==="specific_role")return eligible.filter((e:any)=>String(e.role_title||e.role||"").toLowerCase()===String(config.role||"").toLowerCase()&&(!onShiftIds.size||onShiftIds.has(String(e.id)))).map((e:any)=>String(e.id));
  let onShift=eligible.filter((e:any)=>onShiftIds.has(String(e.id)));
  if(strategy==="shift_leader")return onShift.filter((e:any)=>/lead|leiter|manager/i.test(String(e.role_title||e.role||""))).slice(0,1).map((e:any)=>String(e.id));
  if(strategy==="one_on_shift"){if(String(config.selection||"least_recent")==="least_recent")onShift=await leastRecentlyAssigned(orgId,locationId,String(config.ruleId||""),onShift);return onShift.slice(0,1).map((e:any)=>String(e.id))}
  if(strategy==="round_robin")return onShift.length?[String(onShift[Math.abs(Math.floor(scheduledFor.getTime()/60000))%onShift.length].id)]:[];
  if(strategy==="first_claim")return[null];
  return onShift.map((e:any)=>String(e.id));
}

async function notifyOpenTask(orgId:string,employeeId:string,locationId:string,taskId:string,title:string,dueAt:string){
  const key=`task-open:${taskId}:employee:${employeeId}`,noteId=id("note");
  const{error}=await db.from("notifications").upsert({organization_id:orgId,id:noteId,employee_id:employeeId,location_id:locationId,type:"task_available",title,body:`Offene Aufgabe · fällig bis ${new Date(dueAt).toLocaleString("de-DE")}`,related_entity_type:"task",related_entity_id:taskId,read:false,created_at:nowIso(),payload:{taskId,dueAt,firstClaim:true},idempotency_key:key},{onConflict:"organization_id,idempotency_key",ignoreDuplicates:true});if(error)throw new Error("open_task_notification_failed");
  const{data:note}=await db.from("notifications").select("id").eq("organization_id",orgId).eq("idempotency_key",key).maybeSingle();if(note?.id)await db.from("notification_deliveries").upsert([{organization_id:orgId,notification_id:note.id,channel:"in_app",status:"delivered",attempts:1,idempotency_key:`${key}:in_app`,sent_at:nowIso(),delivered_at:nowIso()},{organization_id:orgId,notification_id:note.id,channel:"web_push",status:"pending",attempts:0,idempotency_key:`${key}:web_push`,next_attempt_at:nowIso()}],{onConflict:"organization_id,idempotency_key",ignoreDuplicates:true});
}

async function processRule(rule:any,template:any,location:any,shifts:any[],runAt:Date){
  const candidates=ruleCandidates(rule,location,shifts,runAt);let generated=0,notifications=0;const errors:string[]=[];
  for(const candidate of candidates){
    let assignees:(string|null)[]=[];try{assignees=await employeesAt(rule.organization_id,rule.location_id,candidate.scheduledFor,shifts,rule.assignment_strategy,{...(rule.assignment_config||{}),ruleId:rule.id},String(location.timezone||"Europe/Berlin"))}catch(e){errors.push(e instanceof Error?e.message:String(e));continue}
    if(!assignees.length)continue;const dueAt=new Date(candidate.scheduledFor.getTime()+minutes(rule.due_offset_minutes)*60000);
    if(rule.assignment_strategy==="shared_on_shift"){
      const employeeIds=[...new Set(assignees.filter(Boolean).map(String))];if(!employeeIds.length)continue;
      const{data,error}=await db.rpc("aora_create_shared_scheduled_task_atomic",{p_organization_id:rule.organization_id,p_rule_id:rule.id,p_template_id:template.id,p_template_version:Number(template.version||template.source_version||1),p_location_id:rule.location_id,p_shift_id:candidate.shiftId,p_employee_ids:employeeIds,p_scheduled_for:candidate.scheduledFor.toISOString(),p_due_at:dueAt.toISOString(),p_instance_date:candidate.localDate,p_blocking_clockout:["MANAGER_OVERRIDE","STRICT_BLOCK"].includes(rule.clockout_policy),p_title:template.title,p_payload:{scheduler:true,assignmentStrategy:"shared_on_shift",completionMode:"ANY_ASSIGNEE",triggerType:rule.trigger_type}});if(error){errors.push("shared_task_create_failed");continue}if(data?.created){generated++;notifications+=Number(data.notificationCount||0)}continue;
    }
    for(const employeeId of assignees){
      const{data,error}=await db.rpc("aora_create_scheduled_task_atomic",{p_organization_id:rule.organization_id,p_rule_id:rule.id,p_template_id:template.id,p_template_version:Number(template.version||template.source_version||1),p_location_id:rule.location_id,p_shift_id:candidate.shiftId,p_employee_id:employeeId,p_scheduled_for:candidate.scheduledFor.toISOString(),p_due_at:dueAt.toISOString(),p_instance_date:candidate.localDate,p_blocking_clockout:["MANAGER_OVERRIDE","STRICT_BLOCK"].includes(rule.clockout_policy),p_title:template.title,p_payload:{scheduler:true,assignmentStrategy:rule.assignment_strategy,triggerType:rule.trigger_type,selection:rule.assignment_config?.selection||null}});if(error){errors.push("task_create_failed");continue}if(data?.created){generated++;notifications+=Number(data.notificationCount||0);if(employeeId===null){try{const potential=await employeesAt(rule.organization_id,rule.location_id,candidate.scheduledFor,shifts,"all_on_shift",{},String(location.timezone||"Europe/Berlin"));for(const e of potential){await notifyOpenTask(rule.organization_id,String(e),rule.location_id,String(data.taskId),`${template.title} – offen`,dueAt.toISOString());notifications++}}catch(e){errors.push(e instanceof Error?e.message:String(e))}}}
    }
  }
  const{error:updateError}=await db.from("task_rules").update({last_run_at:runAt.toISOString(),updated_at:nowIso()}).eq("organization_id",rule.organization_id).eq("id",rule.id);if(updateError)errors.push("rule_last_run_update_failed");
  return{generated,notifications,errors};
}

async function processPage(rules:any[],runAt:Date){
  const orgs=[...new Set(rules.map(r=>String(r.organization_id)))],locationsNeeded=[...new Set(rules.map(r=>String(r.location_id)))],templatesNeeded=[...new Set(rules.map(r=>String(r.template_id)))],today=runAt.toISOString().slice(0,10);
  const[{data:locations,error:le},{data:templates,error:te},{data:shiftRows,error:se}]=await Promise.all([db.from("locations").select("id,organization_id,name,timezone,payload,active,deleted_at").in("id",locationsNeeded).eq("active",true).is("deleted_at",null),db.from("task_templates").select("id,organization_id,title,version,source_version,active,deleted_at").in("id",templatesNeeded).eq("active",true).is("deleted_at",null),db.from("shifts").select("id,organization_id,employee_id,location_id,shift_date,starts_at,ends_at,status,payload,deleted_at").in("organization_id",orgs).gte("shift_date",addDays(today,-2)).lte("shift_date",addDays(today,2)).is("deleted_at",null)]);if(le||te||se)throw new Error("scheduler_page_context_failed");
  const lm=new Map((locations||[]).map((x:any)=>[`${x.organization_id}:${x.id}`,x])),tm=new Map((templates||[]).map((x:any)=>[`${x.organization_id}:${x.id}`,x])),shifts=(shiftRows||[]).map(normalizedShift);let generated=0,notifications=0,errorCount=0;const details:any[]=[];
  for(let i=0;i<rules.length;i+=RULE_CONCURRENCY){const chunk=rules.slice(i,i+RULE_CONCURRENCY);const results=await Promise.all(chunk.map(async rule=>{const location=lm.get(`${rule.organization_id}:${rule.location_id}`),template=tm.get(`${rule.organization_id}:${rule.template_id}`);if(!location||!template)return{ruleId:rule.id,generated:0,notifications:0,errors:["missing_location_or_template"]};try{return{ruleId:rule.id,...await processRule(rule,template,location,shifts,runAt)}}catch(e){return{ruleId:rule.id,generated:0,notifications:0,errors:[e instanceof Error?e.message:String(e)]}}}));for(const r of results){generated+=r.generated;notifications+=r.notifications;errorCount+=r.errors.length;if(r.errors.length)details.push({ruleId:r.ruleId,errors:r.errors.slice(0,5)})}}
  return{generated,notifications,errorCount,details};
}

Deno.serve(async request=>{
  if(request.method!=="POST")return json({error:"method_not_allowed"},405);
  const started=Date.now();
  try{
    const expected=await secret("aora_scheduler_token");if(!expected||request.headers.get("x-aora-job-token")!==expected)return json({error:"forbidden"},403);
    const body=await request.json().catch(()=>({})),runAt=body.scheduled_for?new Date(body.scheduled_for):new Date();if(Number.isNaN(runAt.getTime()))return json({error:"invalid_scheduled_for"},400);const organizationFilter=body.organization_id?uuid(body.organization_id):null;if(body.organization_id&&!organizationFilter)return json({error:"invalid_organization_id"},400);
    let offset=0,pages=0,totalRules=0,generated=0,notifications=0,errorCount=0;const details:any[]=[];
    while(true){
      let query=db.from("task_rules").select("*").eq("active",true).is("deleted_at",null).order("organization_id",{ascending:true}).order("id",{ascending:true}).range(offset,offset+PAGE_SIZE-1);if(organizationFilter)query=query.eq("organization_id",organizationFilter);const{data:rules,error}=await query;if(error)throw new Error("task_rules_page_failed");if(!rules?.length)break;pages++;totalRules+=rules.length;const page=await processPage(rules,runAt);generated+=page.generated;notifications+=page.notifications;errorCount+=page.errorCount;details.push(...page.details.slice(0,Math.max(0,100-details.length)));offset+=rules.length;if(rules.length<PAGE_SIZE)break;if(pages>10000)throw new Error("scheduler_page_guard")
    }
    await db.from("scheduler_runs").insert({job_type:"task_generation",scheduled_for:runAt.toISOString(),started_at:new Date(started).toISOString(),completed_at:nowIso(),status:errorCount?(generated?"partial":"failed"):"completed",generated_count:generated,notification_count:notifications,error_count:errorCount,details:{rules:totalRules,pages,pageSize:PAGE_SIZE,concurrency:RULE_CONCURRENCY,organizationFilter,errors:details,durationMs:Date.now()-started}});
    return json({ok:errorCount===0,generated,notifications,errors:errorCount,rules:totalRules,pages,pageSize:PAGE_SIZE,server_time:nowIso()},errorCount&&!generated?500:200);
  }catch(error){console.error("aora-task-scheduler-v2",error instanceof Error?error.message:String(error));return json({error:"scheduler_failed"},500)}
});
