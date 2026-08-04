import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_ORIGIN="https://dopamine-mobins-projects-4f428afa.vercel.app";
const TEAM_SUFFIX="-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS=new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://dopamine-git-main-mobins-projects-4f428afa.vercel.app",
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app"
]);
const MAX_BODY_BYTES=300_000;

function localHost(hostname:string){const host=hostname.replace(/^\[|\]$/g,"").toLowerCase();return["localhost","0.0.0.0","::1"].includes(host)||/^127(?:\.\d{1,3}){3}$/.test(host)}
function originAllowed(origin:string|null){if(!origin||origin==="null")return true;try{const url=new URL(origin);return EXACT_ORIGINS.has(url.origin)||(url.protocol==="https:"&&url.hostname.endsWith(TEAM_SUFFIX))||(url.protocol==="http:"&&localHost(url.hostname))}catch{return false}}
function cors(origin:string|null){return{
  "Access-Control-Allow-Origin":origin&&originAllowed(origin)?origin:DEFAULT_ORIGIN,
  "Access-Control-Allow-Headers":"content-type,authorization,apikey",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Max-Age":"600",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  Vary:"Origin"
}}
function json(body:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(body),{status,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8"}})}
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function normalizeState(state:any){for(const key of ["admins","employees","locations","timeEntries","notifications","clockRequests"])if(!Array.isArray(state?.[key]))state[key]=[];return state}
function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim()}
function safeDate(value:unknown){const date=String(value||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail("Ungültiges Datum.",400);return date}
function safeTime(value:unknown,required=true){const time=String(value||"");if(!time&&!required)return"";if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))fail("Ungültige Uhrzeit.",400);return time}
function minuteOfDay(value:string){const [hour,minute]=value.split(":").map(Number);return hour*60+minute}
function minutesBetween(start:string,end:string){let value=minuteOfDay(end)-minuteOfDay(start);if(value<0)value+=1440;return value}
function durationMinutes(entry:any){if(!entry?.start||!entry?.end)return 0;return Math.max(0,minutesBetween(String(entry.start),String(entry.end))-Math.max(0,Number(entry.breakMinutes)||0))}
function nowBerlin(){
  const date=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const time=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date()).replace("24:","00:");
  return{date,time,iso:new Date().toISOString()};
}
function notification(employeeId:string,title:string,message:string,kind:string){return{id:`notification_${crypto.randomUUID()}`,employeeId,title,message,type:kind,read:false,createdAt:new Date().toISOString()}}

async function context(token:string){
  if(token.length!==64)fail("Sitzungstoken fehlt.",401);
  const {data:sessions,error}=await service.rpc("validate_demo_session",{p_token:token});
  if(error||!sessions?.length)fail("Sitzung ist ungültig oder abgelaufen.",401);
  const session=sessions[0];
  const {data:organization}=await service.from("organizations").select("id,slug,name,status,timezone").eq("id",session.organization_id).eq("status","active").single();
  if(!organization)fail("Organisation ist nicht aktiv.",403);
  const {data:snapshot}=await service.from("workspace_snapshots").select("state,revision").eq("organization_id",organization.id).single();
  if(!snapshot)fail("Arbeitsbereich wurde nicht gefunden.",404);
  const state=normalizeState(structuredClone(snapshot.state||{}));
  const admin=session.role==="admin"?state.admins.find((item:any)=>item.id===session.subject_id&&item.active!==false&&item.status!=="revoked"&&item.status!=="pending"):null;
  const employee=session.role==="employee"?state.employees.find((item:any)=>item.id===session.subject_id&&item.active!==false&&item.status!=="revoked"):null;
  const accessRole=admin?(admin.scope==="owner"?"owner":"manager"):(employee?"employee":session.role);
  let locationIds:string[]=[];
  if(accessRole==="owner")locationIds=state.locations.filter((item:any)=>item.active!==false).map((item:any)=>String(item.id));
  if(accessRole==="manager"){
    const {data:rows}=await service.from("manager_location_access").select("location_id").eq("organization_id",organization.id).eq("manager_id",session.subject_id);
    locationIds=(rows||[]).map((row:any)=>String(row.location_id));
    if(!locationIds.length)locationIds=(admin?.locationIds||[admin?.locationId]).filter(Boolean).map(String);
  }
  if(accessRole==="employee"&&employee?.locationId)locationIds=[String(employee.locationId)];
  return{session,organization,snapshot,state,admin,employee,accessRole,locationIds};
}
function requireManager(ctx:any){if(!["owner","manager"].includes(ctx.accessRole))fail("Manager-Zugang erforderlich.",403)}
function employeeById(ctx:any,employeeId:string){
  const employee=ctx.state.employees.find((item:any)=>String(item.id)===employeeId&&item.active!==false&&item.status!=="revoked");
  if(!employee)fail("Mitarbeiter wurde nicht gefunden.",404);
  const locationId=String(employee.locationId||employee.primaryLocationId||"");
  if(ctx.accessRole==="manager"&&!ctx.locationIds.includes(locationId))fail("Kein Zugriff auf diesen Mitarbeiter.",403);
  if(ctx.accessRole==="employee"&&String(ctx.session.subject_id)!==employeeId)fail("Kein Zugriff auf diesen Mitarbeiter.",403);
  return{employee,locationId};
}
function activeEntry(state:any,employeeId:string){return(state.timeEntries||[]).find((item:any)=>String(item.employeeId??item.employee_id)===employeeId&&["live","paused"].includes(String(item.status||"")))}
function entryById(ctx:any,id:string){
  const entry=ctx.state.timeEntries.find((item:any)=>String(item.id)===id);
  if(!entry)fail("Arbeitszeiteintrag wurde nicht gefunden.",404);
  const employeeId=String((entry.employeeId??entry.employee_id)||"");
  const {locationId}=employeeById(ctx,employeeId);
  if(String((entry.locationId??entry.location_id)||locationId)!==locationId&&ctx.accessRole!=="owner")fail("Kein Zugriff auf diese Buchung.",403);
  return entry;
}
function proposedEntry(base:any,body:any,{employeeId,locationId,id}:{employeeId:string,locationId:string,id:string}){
  const date=safeDate(body.date??base?.date);
  const start=safeTime(body.start??base?.start);
  const end=safeTime(body.end??base?.end);
  const breakMinutes=Math.max(0,Math.min(720,Number(body.breakMinutes??base?.breakMinutes??0)||0));
  const next={...base,id,employeeId,locationId,date,start,end,breakMinutes,status:"completed"};
  next.durationMinutes=durationMinutes(next);
  delete next.pauseStartedAt;delete next.pause_started_at;
  return next;
}
async function selectCorrections(ctx:any){
  let query=service.from("time_entry_corrections").select("*").eq("organization_id",ctx.organization.id).order("requested_at",{ascending:false});
  if(ctx.accessRole==="employee")query=query.eq("employee_id",String(ctx.session.subject_id));
  if(ctx.accessRole==="manager")query=query.in("location_id",ctx.locationIds.length?ctx.locationIds:["__none__"]);
  const {data,error}=await query;if(error)throw error;return data||[];
}

async function managerPunch(ctx:any,body:any){
  requireManager(ctx);
  const employeeId=String(body.employeeId||"");
  const action=String(body.punchAction||"");
  const reason=clean(body.reason);
  if(reason.length<5)fail("Bitte eine kurze Begründung mit mindestens 5 Zeichen angeben.",400);
  if(!["in","out","pause","resume"].includes(action))fail("Ungültige Stempelaktion.",400);
  const {employee,locationId}=employeeById(ctx,employeeId);
  const state=structuredClone(ctx.state);
  const current=activeEntry(state,employeeId);
  const now=nowBerlin();
  let previous:any=null;let next:any;let entryId:string;
  if(action==="in"){
    if(current)fail("Der Mitarbeiter ist bereits eingestempelt.",409);
    entryId=`time_manager_${crypto.randomUUID()}`;
    next={id:entryId,employeeId,locationId,date:now.date,start:now.time,end:"",breakMinutes:0,durationMinutes:0,status:"live",source:"manager_direct",version:1,ruleSetVersion:1,createdAt:now.iso,createdBy:ctx.session.subject_id,managerReason:reason};
    state.timeEntries.push(next);
  }else{
    if(!current)fail("Für den Mitarbeiter läuft aktuell keine Arbeitszeit.",409);
    entryId=String(current.id);previous=structuredClone(current);
    const index=state.timeEntries.findIndex((item:any)=>String(item.id)===entryId);
    next={...state.timeEntries[index]};
    if(action==="pause"){
      if(next.status!=="live")fail("Die Arbeitszeit ist nicht aktiv.",409);
      next.status="paused";next.pauseStartedAt=now.time;next.pauseStartedAtIso=now.iso;
    }
    if(action==="resume"){
      if(next.status!=="paused")fail("Der Mitarbeiter befindet sich nicht in Pause.",409);
      const pauseStart=String(next.pauseStartedAt||now.time);
      next.breakMinutes=Math.max(0,Number(next.breakMinutes)||0)+minutesBetween(pauseStart,now.time);
      next.status="live";delete next.pauseStartedAt;delete next.pauseStartedAtIso;
    }
    if(action==="out"){
      if(next.status==="paused"){
        const pauseStart=String(next.pauseStartedAt||now.time);
        next.breakMinutes=Math.max(0,Number(next.breakMinutes)||0)+minutesBetween(pauseStart,now.time);
      }
      next.end=now.time;next.status="completed";next.durationMinutes=durationMinutes(next);next.endedAt=now.iso;delete next.pauseStartedAt;delete next.pauseStartedAtIso;
    }
    next.updatedAt=now.iso;next.updatedBy=ctx.session.subject_id;next.managerReason=reason;
    state.timeEntries[index]=next;
  }
  state.notifications.push(notification(employeeId,"Arbeitszeit durch Manager aktualisiert",`${employee.name}: ${action==="in"?"eingestempelt":action==="out"?"ausgestempelt":action==="pause"?"Pause gestartet":"Pause beendet"}. Grund: ${reason}`,"manager_direct_punch"));
  const {data,error}=await service.rpc("aora_manager_direct_punch_atomic",{
    p_organization_id:ctx.organization.id,p_expected_revision:Number(ctx.snapshot.revision),p_state:state,p_time_entry_id:entryId,p_employee_id:employeeId,p_location_id:locationId,p_actor_id:ctx.session.subject_id,p_actor_type:ctx.accessRole,p_action:action,p_previous_value:previous,p_new_value:next,p_reason:reason
  });
  if(error)throw error;
  return{entry:next,result:data?.[0]||null};
}

async function managerRequestChange(ctx:any,body:any){
  requireManager(ctx);
  const employeeId=String(body.employeeId||"");
  const reason=clean(body.reason);
  if(reason.length<5)fail("Bitte eine Begründung mit mindestens 5 Zeichen angeben.",400);
  const {employee,locationId}=employeeById(ctx,employeeId);
  const changeType=body.changeType==="create_entry"?"create_entry":"edit_entry";
  let previous:any={};let entryId:string;let proposed:any;
  if(changeType==="edit_entry"){
    previous=entryById(ctx,String(body.timeEntryId||""));
    if(["live","paused"].includes(String(previous.status||""))||!previous.end)fail("Eine laufende Buchung wird direkt über Übersicht beendet. Nachträgliche Änderungen sind nur für abgeschlossene Buchungen möglich.",409);
    entryId=String(previous.id);
    proposed=proposedEntry(previous,body,{employeeId,locationId,id:entryId});
  }else{
    entryId=`time_pending_${crypto.randomUUID()}`;
    proposed=proposedEntry({},body,{employeeId,locationId,id:entryId});
    proposed.source="manager_created_after_employee_approval";proposed.version=1;proposed.ruleSetVersion=1;proposed.createdAt=new Date().toISOString();
  }
  const state=structuredClone(ctx.state);
  state.notifications.push(notification(employeeId,"Änderung deiner Arbeitszeit prüfen",`${employee.name}: ${changeType==="create_entry"?"Neue Buchung":"Änderung"} für ${proposed.date}, ${proposed.start}–${proposed.end}.`,"manager_time_change"));
  const {data,error}=await service.rpc("aora_create_manager_time_change_atomic",{
    p_organization_id:ctx.organization.id,p_expected_revision:Number(ctx.snapshot.revision),p_time_entry_id:entryId,p_employee_id:employeeId,p_location_id:locationId,p_actor_id:ctx.session.subject_id,p_previous_value:previous,p_proposed_value:proposed,p_reason:reason,p_change_type:changeType,p_state:state
  });
  if(error)throw error;
  return{correctionId:data?.[0]?.correction_id,proposed,result:data?.[0]||null};
}

async function decideChange(ctx:any,body:any){
  const correctionId=String(body.correctionId||"");
  const decision=String(body.decision||"");
  const decisionReason=clean(body.decisionReason);
  if(!["approved","rejected"].includes(decision))fail("Ungültige Entscheidung.",400);
  if(decision==="rejected"&&decisionReason.length<5)fail("Bei Ablehnung ist eine Begründung mit mindestens 5 Zeichen erforderlich.",400);
  const {data:correction,error}=await service.from("time_entry_corrections").select("*").eq("organization_id",ctx.organization.id).eq("id",correctionId).single();
  if(error||!correction)fail("Änderungsanfrage wurde nicht gefunden.",404);
  const employeeId=String(correction.employee_id);
  employeeById(ctx,employeeId);
  const expectedTarget=ctx.accessRole==="employee"?"employee":"manager";
  if(String(correction.approval_target)!==expectedTarget)fail("Diese Änderung muss von einer anderen Rolle bestätigt werden.",403);
  if(ctx.accessRole==="employee"&&employeeId!==String(ctx.session.subject_id))fail("Diese Änderung gehört zu einem anderen Mitarbeiter.",403);
  if(!["owner","manager","employee"].includes(ctx.accessRole))fail("Keine Berechtigung für diese Entscheidung.",403);
  const state=structuredClone(ctx.state);
  let previous=correction.previous_value||{};let next=correction.proposed_value||{};
  if(decision==="approved"){
    if(correction.change_type==="create_entry"){
      if(state.timeEntries.some((item:any)=>String(item.id)===String(correction.time_entry_id)))fail("Die vorgeschlagene Buchung existiert bereits.",409);
      next={...next,status:"completed",confirmedAt:new Date().toISOString(),confirmedBy:ctx.session.subject_id};
      state.timeEntries.push(next);
    }else{
      const index=state.timeEntries.findIndex((item:any)=>String(item.id)===String(correction.time_entry_id));
      if(index<0)fail("Die zu ändernde Buchung wurde nicht gefunden.",409);
      previous=state.timeEntries[index];
      next={...state.timeEntries[index],...next,status:"completed",correctedAt:new Date().toISOString(),correctedBy:ctx.session.subject_id};
      state.timeEntries[index]=next;
    }
    if(expectedTarget==="manager")state.notifications.push(notification(employeeId,"Zeitkorrektur bearbeitet",`Deine Korrektur wurde ${decision==="approved"?"genehmigt":"abgelehnt"}.`,"time_change_decision"));
  }
  const {data:result,error:rpcError}=await service.rpc("aora_decide_time_change_atomic",{
    p_organization_id:ctx.organization.id,p_expected_revision:Number(ctx.snapshot.revision),p_correction_id:correction.id,p_decision:decision,p_actor_type:ctx.accessRole,p_actor_id:ctx.session.subject_id,p_expected_approval_target:expectedTarget,p_decision_reason:decisionReason,p_state:decision==="approved"?state:null,p_previous_value:previous,p_new_value:next,p_rule_set_version:Number(previous?.ruleSetVersion||next?.ruleSetVersion||1)
  });
  if(rpcError)throw rpcError;
  return{decision,result:result?.[0]||null};
}

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST")return json({error:"Method not allowed"},405,origin);
  if(!originAllowed(origin))return json({error:"Origin not allowed"},403,origin);
  const text=await request.text();
  if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)return json({error:"Request too large"},413,origin);
  let body:any;try{body=JSON.parse(text||"{}")}catch{return json({error:"Invalid request"},400,origin)}
  try{
    const ctx=await context(String(body.token||""));
    const action=String(body.action||"");
    if(action==="overview"){
      const corrections=await selectCorrections(ctx);
      const employees=ctx.accessRole==="employee"?[ctx.employee]:ctx.state.employees.filter((item:any)=>item.active!==false&&item.status!=="revoked"&&item.status!=="pending").filter((item:any)=>ctx.accessRole==="owner"||ctx.locationIds.includes(String(item.locationId||item.primaryLocationId||"")));
      return json({employees,corrections,accessRole:ctx.accessRole,revision:ctx.snapshot.revision},200,origin);
    }
    if(action==="managerPunch")return json(await managerPunch(ctx,body),200,origin);
    if(action==="managerRequestChange")return json(await managerRequestChange(ctx,body),201,origin);
    if(action==="decideChange")return json(await decideChange(ctx,body),200,origin);
    return json({error:"Unknown action"},400,origin);
  }catch(error:any){console.error("Aora worktime center failed",error);return json({error:error instanceof Error?error.message:String(error)},Number(error?.status||500),origin)}
});
