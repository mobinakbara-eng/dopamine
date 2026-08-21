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
const MAX_BODY_BYTES=250000;
const MAX_EXPORT_BYTES=3*1024*1024;

function localHost(hostname:string){
  const host=hostname.replace(/^\[|\]$/g,"").toLowerCase();
  return["localhost","0.0.0.0","::1"].includes(host)||/^127(?:\.\d{1,3}){3}$/.test(host);
}
function originAllowed(origin:string|null){
  if(!origin||origin==="null")return true;
  try{
    const parsed=new URL(origin);
    return EXACT_ORIGINS.has(parsed.origin)||(parsed.protocol==="https:"&&parsed.hostname.endsWith(TEAM_SUFFIX))||(parsed.protocol==="http:"&&localHost(parsed.hostname));
  }catch{return false}
}
function cors(origin:string|null){
  return{
    "Access-Control-Allow-Origin":origin&&originAllowed(origin)?origin:DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers":"content-type",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Access-Control-Expose-Headers":"content-disposition,x-aora-export-checksum,x-aora-export-period",
    "Access-Control-Max-Age":"600",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    Vary:"Origin"
  };
}
function json(body:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{status,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8"}});
}
function fail(message:string,status=400,code="request_failed",details?:unknown):never{
  throw Object.assign(new Error(message),{status,code,details});
}
const clean=(value:unknown)=>String(value??"").replace(/\s+/g," ").trim();
function digits(value:unknown,min:number,max:number,label:string){
  const result=clean(value);
  if(!new RegExp(`^\\d{${min},${max}}$`).test(result))fail(`${label} ist ungültig.`,400,"invalid_datev_mapping");
  return result;
}
function monthValue(value:unknown){
  const result=clean(value);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(result))fail("Abrechnungsmonat ist ungültig.",400,"invalid_period");
  return result;
}
function monthRange(period:string){
  const[year,month]=period.split("-").map(Number);
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return{from:`${period}-01`,to:`${period}-${String(last).padStart(2,"0")}`,datev:`01/${String(month).padStart(2,"0")}/${year}`};
}
function normalizeState(state:any){
  for(const key of["admins","employees","locations","timeEntries"])if(!Array.isArray(state?.[key]))state[key]=[];
  return state;
}
const employeeLocation=(employee:any)=>String(employee?.locationId||employee?.primaryLocationId||"");
const entryEmployeeId=(entry:any)=>String(entry?.employeeId??entry?.employee_id??"");
const entryLocationId=(entry:any)=>String(entry?.locationId??entry?.location_id??"");
const entryDate=(entry:any)=>String(entry?.date||entry?.startTime||entry?.start_time||"").slice(0,10);
function clockMinutes(value:unknown){
  const match=String(value||"").match(/^(\d{1,2}):(\d{2})/);
  return match?Number(match[1])*60+Number(match[2]):null;
}
function entryMinutes(entry:any){
  const stored=Number(entry?.durationMinutes??entry?.duration_minutes);
  if(Number.isFinite(stored)&&stored>=0)return Math.round(stored);
  const startRaw=entry?.start??entry?.startTime??entry?.start_time;
  const endRaw=entry?.end??entry?.endTime??entry?.end_time;
  const start=clockMinutes(String(startRaw||"").includes("T")?String(startRaw).slice(11,16):startRaw);
  let end=clockMinutes(String(endRaw||"").includes("T")?String(endRaw).slice(11,16):endRaw);
  if(start===null||end===null)return 0;
  if(end<start)end+=1440;
  const breakMinutes=Math.max(0,Number(entry?.breakMinutes??entry?.break_minutes??0)||0);
  return Math.max(0,Math.round(end-start-breakMinutes));
}
function entryOpen(entry:any){
  const status=String(entry?.status||"").toLowerCase();
  const end=entry?.end??entry?.endTime??entry?.end_time;
  return["live","paused","open","running"].includes(status)||!end;
}
function decimalComma(value:number){
  if(!Number.isFinite(value))fail("Ungültiger Stundenwert.",422,"invalid_hours_value");
  return value.toFixed(2).replace(".",",");
}
async function sha256(bytes:Uint8Array){
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return[...new Uint8Array(digest)].map(part=>part.toString(16).padStart(2,"0")).join("");
}

async function context(token:string){
  if(token.length!==64)fail("Sitzungstoken fehlt.",401,"session_missing");
  const{data:sessions,error}=await service.rpc("validate_demo_session",{p_token:token});
  if(error||!sessions?.length)fail("Sitzung ist ungültig oder abgelaufen.",401,"session_invalid");
  const session=sessions[0];
  const{data:organization}=await service.from("organizations").select("id,slug,name,status,timezone").eq("id",session.organization_id).eq("status","active").single();
  if(!organization)fail("Organisation ist nicht aktiv.",403,"organization_inactive");
  const{data:snapshot}=await service.from("workspace_snapshots").select("state,revision").eq("organization_id",organization.id).single();
  if(!snapshot)fail("Arbeitsbereich wurde nicht gefunden.",404,"workspace_missing");
  const state=normalizeState(structuredClone(snapshot.state||{}));
  const admin=session.role==="admin"?state.admins.find((item:any)=>item.id===session.subject_id&&item.active!==false&&item.status!=="revoked"&&item.status!=="pending"):null;
  const accessRole=admin?(admin.scope==="owner"?"owner":"manager"):session.role;
  if(!["owner","manager"].includes(accessRole))fail("Export-Berechtigung fehlt.",403,"manager_required");
  let locationIds:string[]=[];
  if(accessRole==="owner")locationIds=state.locations.filter((item:any)=>item.active!==false).map((item:any)=>String(item.id));
  if(accessRole==="manager"){
    const{data:rows}=await service.from("manager_location_access").select("location_id").eq("organization_id",organization.id).eq("manager_id",session.subject_id);
    locationIds=(rows||[]).map((row:any)=>String(row.location_id));
    if(!locationIds.length)locationIds=(admin?.locationIds||[admin?.locationId]).filter(Boolean).map(String);
  }
  return{session,organization,state,accessRole,locationIds};
}
function requireManager(ctx:any){if(!["owner","manager"].includes(ctx.accessRole))fail("Manager-Zugang erforderlich.",403,"manager_required")}
function scopedEmployees(ctx:any,period:string){
  const range=monthRange(period);
  const employeeById=new Map(ctx.state.employees.map((employee:any)=>[String(employee.id),employee]));
  const monthEntries=ctx.state.timeEntries.filter((entry:any)=>{
    const date=entryDate(entry);
    if(date<range.from||date>range.to)return false;
    if(ctx.accessRole==="owner")return true;
    const explicitLocationId=entryLocationId(entry);
    if(explicitLocationId)return ctx.locationIds.includes(explicitLocationId);
    return ctx.locationIds.includes(employeeLocation(employeeById.get(entryEmployeeId(entry))));
  });
  const relevantIds=new Set(monthEntries.map((entry:any)=>entryEmployeeId(entry)).filter(Boolean));
  const employees=ctx.state.employees.filter((employee:any)=>{
    const employeeId=String(employee.id);
    const accessible=ctx.accessRole==="owner"||ctx.locationIds.includes(employeeLocation(employee))||relevantIds.has(employeeId);
    return accessible&&(employee.active!==false||relevantIds.has(employeeId));
  });
  return{range,monthEntries,employees};
}
async function mappingRows(ctx:any,employeeIds:string[]){
  if(!employeeIds.length)return[];
  const{data,error}=await service.from("datev_hours_employee_mappings").select("employee_id,personnel_number,updated_at").eq("organization_id",ctx.organization.id).in("employee_id",employeeIds);
  if(error)throw error;
  return data||[];
}
async function settingsRow(ctx:any){
  const{data,error}=await service.from("datev_hours_export_settings").select("target_system,berater_number,mandant_number,regular_wage_type,updated_at").eq("organization_id",ctx.organization.id).maybeSingle();
  if(error)throw error;
  return data;
}
function hoursSummary(ctx:any,period:string){
  const scoped=scopedEmployees(ctx,period);
  const summary=new Map<string,{minutes:number;openEntries:number;entries:number}>();
  for(const employee of scoped.employees)summary.set(String(employee.id),{minutes:0,openEntries:0,entries:0});
  for(const entry of scoped.monthEntries){
    const employeeId=entryEmployeeId(entry);
    if(!summary.has(employeeId))continue;
    const current=summary.get(employeeId)!;
    current.entries+=1;
    if(entryOpen(entry))current.openEntries+=1;
    else current.minutes+=entryMinutes(entry);
  }
  return{scoped,summary};
}
async function status(ctx:any,body:any){
  const period=monthValue(body.period);
  const{scoped,summary}=hoursSummary(ctx,period);
  const settings=await settingsRow(ctx);
  const mappings=await mappingRows(ctx,scoped.employees.map((employee:any)=>String(employee.id)));
  const mappingMap=new Map(mappings.map((row:any)=>[String(row.employee_id),row]));
  const employees=scoped.employees.map((employee:any)=>{
    const totals=summary.get(String(employee.id))||{minutes:0,openEntries:0,entries:0};
    const mapping:any=mappingMap.get(String(employee.id));
    return{id:String(employee.id),name:clean(employee.name||"Mitarbeiter/in"),locationId:employeeLocation(employee),active:employee.active!==false,personnelNumber:mapping?.personnel_number||null,minutes:totals.minutes,entries:totals.entries,openEntries:totals.openEntries,included:totals.minutes>0||totals.openEntries>0};
  });
  const included=employees.filter((employee:any)=>employee.included);
  return{period,targetSystem:"datev_lodas",settings,employees,totals:{employees:included.length,minutes:included.reduce((sum:number,employee:any)=>sum+Number(employee.minutes||0),0),openEntries:included.reduce((sum:number,employee:any)=>sum+Number(employee.openEntries||0),0),missingPersonnelNumbers:included.filter((employee:any)=>!employee.personnelNumber).length},canConfigure:["owner","manager"].includes(ctx.accessRole)};
}
async function saveConfig(ctx:any,body:any){
  requireManager(ctx);
  const period=monthValue(body.period);
  const beraterNumber=digits(body.beraterNumber,4,7,"Beraternummer");
  const mandantNumber=digits(body.mandantNumber,1,5,"Mandantennummer");
  const regularWageType=digits(body.regularWageType,1,4,"Lohnart Arbeitsstunden");
  const{scoped,summary}=hoursSummary(ctx,period);
  const visibleIds=new Set(scoped.employees.filter((employee:any)=>{const totals=summary.get(String(employee.id));return totals&&(totals.minutes>0||totals.openEntries>0)}).map((employee:any)=>String(employee.id)));
  const rawMappings=Array.isArray(body.employeeMappings)?body.employeeMappings:[];
  const seenPersonnel=new Set<string>();
  const mappings=rawMappings.map((mapping:any)=>{
    const employeeId=clean(mapping.employeeId);
    if(!visibleIds.has(employeeId))fail("Mitarbeiter-Zuordnung ist nicht zulässig.",403,"employee_mapping_scope");
    const rawPersonnel=clean(mapping.personnelNumber);
    if(!rawPersonnel)return{employeeId,personnelNumber:null as string|null};
    const personnelNumber=digits(rawPersonnel,1,9,"Personalnummer");
    if(seenPersonnel.has(personnelNumber))fail(`Personalnummer ${personnelNumber} ist doppelt vergeben.`,409,"duplicate_personnel_number");
    seenPersonnel.add(personnelNumber);
    return{employeeId,personnelNumber};
  });
  const now=new Date().toISOString();
  const{error:settingError}=await service.from("datev_hours_export_settings").upsert({organization_id:ctx.organization.id,target_system:"datev_lodas",berater_number:beraterNumber,mandant_number:mandantNumber,regular_wage_type:regularWageType,updated_by:String(ctx.session.subject_id),updated_at:now},{onConflict:"organization_id"});
  if(settingError)throw settingError;
  for(const mapping of mappings){
    if(!mapping.personnelNumber){
      const{error}=await service.from("datev_hours_employee_mappings").delete().eq("organization_id",ctx.organization.id).eq("employee_id",mapping.employeeId);
      if(error)throw error;
      continue;
    }
    const{error}=await service.from("datev_hours_employee_mappings").upsert({organization_id:ctx.organization.id,employee_id:mapping.employeeId,personnel_number:mapping.personnelNumber,updated_by:String(ctx.session.subject_id),updated_at:now},{onConflict:"organization_id,employee_id"});
    if(error){
      if(String((error as any).code)==="23505")fail("Eine DATEV-Personalnummer darf nur einem Mitarbeiter zugeordnet sein.",409,"duplicate_personnel_number");
      throw error;
    }
  }
  return status(ctx,{period});
}
async function createExport(ctx:any,body:any,origin:string|null){
  const period=monthValue(body.period);
  const settings=await settingsRow(ctx);
  if(!settings)fail("DATEV-Zuordnung ist noch nicht eingerichtet.",409,"datev_hours_settings_missing");
  const{scoped,summary}=hoursSummary(ctx,period);
  const includedEmployees=scoped.employees.filter((employee:any)=>{const totals=summary.get(String(employee.id));return totals&&(totals.minutes>0||totals.openEntries>0)});
  if(!includedEmployees.length)fail("Für diesen Monat wurden keine Arbeitsstunden gefunden.",409,"datev_hours_empty");
  const open=includedEmployees.filter((employee:any)=>Number(summary.get(String(employee.id))?.openEntries||0)>0);
  if(open.length)fail("Offene oder laufende Arbeitszeitbuchungen müssen vor dem DATEV-Export abgeschlossen werden.",409,"datev_hours_open_entries",open.map((employee:any)=>clean(employee.name)));
  const mappings=await mappingRows(ctx,includedEmployees.map((employee:any)=>String(employee.id)));
  const mappingMap=new Map(mappings.map((row:any)=>[String(row.employee_id),String(row.personnel_number)]));
  const missing=includedEmployees.filter((employee:any)=>!mappingMap.get(String(employee.id)));
  if(missing.length)fail("Für alle Mitarbeiter mit Stunden wird eine DATEV-Personalnummer benötigt.",409,"datev_personnel_number_missing",missing.map((employee:any)=>({id:String(employee.id),name:clean(employee.name)})));
  const used=new Set<string>();
  for(const employee of includedEmployees){
    const personnel=mappingMap.get(String(employee.id))!;
    if(used.has(personnel))fail(`Personalnummer ${personnel} ist mehrfach zugeordnet.`,409,"duplicate_personnel_number");
    used.add(personnel);
  }
  const rows=includedEmployees.map((employee:any)=>({personnel:mappingMap.get(String(employee.id))!,minutes:Number(summary.get(String(employee.id))?.minutes||0)})).filter(row=>row.minutes>0).sort((a,b)=>a.personnel.localeCompare(b.personnel,"de",{numeric:true})).map(row=>`3;${scoped.range.datev};${decimalComma(row.minutes/60)};01;${settings.regular_wage_type};${row.personnel};`);
  if(!rows.length)fail("Für diesen Monat wurden keine abgeschlossenen Arbeitsstunden gefunden.",409,"datev_hours_empty");
  const file=[
    "[Allgemein]",
    "Ziel=LODAS",
    `BeraterNr=${settings.berater_number}`,
    `MandantenNr=${settings.mandant_number}`,
    "Feldtrennzeichen=;",
    "Stringbegrenzer='",
    "Datumsformat=TT/MM/JJJJ",
    "Zahlenkomma=,",
    "[Satzbeschreibung]",
    "3;u_lod_bwd_buchung_standard;abrechnung_zeitraum#bwd;bs_wert_butab#bwd;bs_nr#bwd;la_eigene#bwd;pnr#bwd;",
    "[Bewegungsdaten]",
    ...rows,
    ""
  ].join("\r\n");
  const bytes=new TextEncoder().encode(file);
  if(bytes.length>MAX_EXPORT_BYTES)fail("DATEV-Stundenexport überschreitet 3 MB.",413,"datev_hours_too_large");
  const checksum=await sha256(bytes);
  const totalMinutes=includedEmployees.reduce((sum:number,employee:any)=>sum+Number(summary.get(String(employee.id))?.minutes||0),0);
  const{error:logError}=await service.from("datev_hours_export_runs").insert({organization_id:ctx.organization.id,period,target_system:"datev_lodas",row_count:rows.length,total_minutes:totalMinutes,checksum_sha256:checksum,created_by:String(ctx.session.subject_id),metadata:{kind:"regular_hours_only",bookingKey:"01",wageType:settings.regular_wage_type,scope:ctx.accessRole,managerLocationIds:ctx.accessRole==="manager"?ctx.locationIds:[]}});
  if(logError)throw logError;
  const filename=`AORA_DATEV_LODAS_STUNDEN_${period}.txt`;
  return new Response(bytes,{status:200,headers:{...cors(origin),"Content-Type":"text/plain; charset=us-ascii","Content-Disposition":`attachment; filename=${filename}`,"X-Aora-Export-Checksum":checksum,"X-Aora-Export-Period":period}});
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);
  if(!originAllowed(origin))return json({ok:false,error:"origin_not_allowed"},403,origin);
  try{
    const text=await req.text();
    if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)return json({ok:false,error:"payload_too_large"},413,origin);
    let body:any={};
    try{body=text?JSON.parse(text):{}}catch{fail("Ungültige Anfrage.",400,"invalid_json")}
    const ctx=await context(String(body.token||""));
    const action=String(body.action||"");
    if(action==="status")return json({ok:true,result:await status(ctx,body)},200,origin);
    if(action==="save_config")return json({ok:true,result:await saveConfig(ctx,body)},200,origin);
    if(action==="export")return await createExport(ctx,body,origin);
    return json({ok:false,error:"unknown_action"},404,origin);
  }catch(error:any){
    return json({ok:false,error:error?.code||"datev_hours_export_failed",message:clean(error?.message)||"DATEV-Stundenexport fehlgeschlagen.",details:error?.details||null},Number(error?.status||500),origin);
  }
});