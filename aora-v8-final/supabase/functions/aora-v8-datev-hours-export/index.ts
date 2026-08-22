import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {decimalComma,entryMinutes,monthRange,stableStringify} from "./core.ts";

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
  "https://aora-workforce.vercel.app",
  "https://aora-ipad-staging-public.vercel.app",
  "https://aora-ipad-staging-final.vercel.app"
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
    "Access-Control-Expose-Headers":"content-disposition,x-aora-export-checksum,x-aora-export-period,x-aora-datev-validation",
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
function datevPersonnelNumber(value:unknown){
  const result=digits(value,1,5,"Personalnummer");
  const numeric=Number(result);
  if(!Number.isInteger(numeric)||numeric<1||numeric>99999)fail("Personalnummer muss zwischen 1 und 99999 liegen.",400,"invalid_datev_personnel_number");
  return result;
}
function monthValue(value:unknown){
  const result=clean(value);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(result))fail("Abrechnungsmonat ist ungültig.",400,"invalid_period");
  return result;
}
function normalizeState(state:any){
  for(const key of["admins","employees","locations","timeEntries"])if(!Array.isArray(state?.[key]))state[key]=[];
  return state;
}
const employeeLocation=(employee:any)=>String(employee?.locationId||employee?.primaryLocationId||"");
const entryEmployeeId=(entry:any)=>String(entry?.employeeId??entry?.employee_id??"");
const entryLocationId=(entry:any)=>String(entry?.locationId??entry?.location_id??"");
const entryDate=(entry:any)=>String(entry?.date||entry?.startTime||entry?.start_time||"").slice(0,10);
function entryOpen(entry:any){
  const status=String(entry?.status||"").toLowerCase();
  const end=entry?.end??entry?.endTime??entry?.end_time;
  return["live","paused","open","running"].includes(status)||!end;
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
  return{session,organization,state,sourceRevision:Number(snapshot.revision),accessRole,locationIds};
}
function requireManager(ctx:any){if(!["owner","manager"].includes(ctx.accessRole))fail("Manager-Zugang erforderlich.",403,"manager_required")}
function requireOwner(ctx:any){if(ctx.accessRole!=="owner")fail("Nur Inhaber dürfen die organisationsweiten DATEV-Zuordnungen ändern.",403,"owner_required")}
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
  const{data,error}=await service.from("datev_hours_export_settings").select("target_system,berater_number,mandant_number,regular_wage_type,updated_at,version").eq("organization_id",ctx.organization.id).maybeSingle();
  if(error)throw error;
  return data;
}

async function finalPayrollSnapshot(ctx:any,period:string){
  const range=monthRange(period),locationIds=ctx.accessRole==="manager"?ctx.locationIds:[];
  let query=service.from("timesheet_submissions").select("id,employee_id,location_id,date_from,date_to,status,version,snapshot_hash,signed_hash,payload,approved_at,locked_at").eq("organization_id",ctx.organization.id).eq("date_from",range.from).eq("date_to",range.to).in("status",["approved","locked"]);
  if(ctx.accessRole==="manager")query=query.in("location_id",locationIds.length?locationIds:["__none__"]);
  const{data:submissions,error}=await query;
  if(error)throw error;
  const employeeIds=[...new Set((submissions||[]).map((row:any)=>String(row.employee_id)))];
  let correctionQuery=service.from("time_entry_corrections").select("id,employee_id,location_id,previous_value,proposed_value,requested_at").eq("organization_id",ctx.organization.id).eq("status","pending");
  if(employeeIds.length)correctionQuery=correctionQuery.in("employee_id",employeeIds);else return{range,rows:[],submissions:[],invalidSnapshots:[],openDays:0,pendingCorrections:[]};
  const{data:corrections,error:correctionError}=await correctionQuery;if(correctionError)throw correctionError;
  const pendingCorrections=(corrections||[]).filter((row:any)=>{const date=String(row.proposed_value?.date||row.previous_value?.date||"").slice(0,10);return!date||(date>=range.from&&date<=range.to)});
  const rows:any[]=[],invalidSnapshots:string[]=[];let openDays=0;
  for(const submission of submissions||[]){
    const snapshot=submission.payload?.snapshot;
    if(!snapshot||await sha256(new TextEncoder().encode(stableStringify(snapshot)))!==submission.snapshot_hash){invalidSnapshots.push(String(submission.id));continue}
    openDays+=Number(snapshot.totals?.openDays||0);
    const minutes=(snapshot.rows||[]).filter((row:any)=>row.type==="Arbeit").reduce((sum:number,row:any)=>sum+Math.max(0,Number(row.netMinutes)||0),0);
    rows.push({employeeId:String(submission.employee_id),locationId:String(submission.location_id||snapshot.location?.id||""),minutes,submissionId:String(submission.id),submissionVersion:Number(submission.version||1),snapshotHash:String(submission.snapshot_hash),signedHash:String(submission.signed_hash||"")});
  }
  return{range,rows,submissions:submissions||[],invalidSnapshots,openDays,pendingCorrections};
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
  const finalSnapshot=await finalPayrollSnapshot(ctx,period),finalIds=new Set(finalSnapshot.rows.map((row:any)=>row.employeeId)),includedIds=new Set(included.map((employee:any)=>String(employee.id))),missingFinal=[...includedIds].filter(id=>!finalIds.has(id));
  const finalMappingRows=await mappingRows(ctx,finalSnapshot.rows.map((row:any)=>row.employeeId)),finalMappingIds=new Set(finalMappingRows.map((row:any)=>String(row.employee_id)));
  const finalReadiness={ready:finalSnapshot.rows.length>0&&!missingFinal.length&&!finalSnapshot.invalidSnapshots.length&&!finalSnapshot.openDays&&!finalSnapshot.pendingCorrections.length&&finalSnapshot.rows.every((row:any)=>finalMappingIds.has(row.employeeId)),employees:finalSnapshot.rows.length,minutes:finalSnapshot.rows.reduce((sum:number,row:any)=>sum+row.minutes,0),missingApprovedSnapshots:missingFinal.length,invalidSnapshots:finalSnapshot.invalidSnapshots.length,openDays:finalSnapshot.openDays,pendingCorrections:finalSnapshot.pendingCorrections.length,missingPersonnelNumbers:finalSnapshot.rows.filter((row:any)=>!finalMappingIds.has(row.employeeId)).length};
  return{period,targetSystem:"datev_lodas",settings,employees,totals:{employees:included.length,minutes:included.reduce((sum:number,employee:any)=>sum+Number(employee.minutes||0),0),openEntries:included.reduce((sum:number,employee:any)=>sum+Number(employee.openEntries||0),0),missingPersonnelNumbers:included.filter((employee:any)=>!employee.personnelNumber).length},finalReadiness,canConfigure:ctx.accessRole==="owner",validationStatus:"not_test_imported"};
}
async function saveConfig(ctx:any,body:any){
  requireOwner(ctx);
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
    const personnelNumber=datevPersonnelNumber(rawPersonnel);
    if(seenPersonnel.has(personnelNumber))fail(`Personalnummer ${personnelNumber} ist doppelt vergeben.`,409,"duplicate_personnel_number");
    seenPersonnel.add(personnelNumber);
    return{employeeId,personnelNumber};
  });
  const{error}=await service.rpc("aora_datev_save_hours_config_atomic",{p_organization_id:ctx.organization.id,p_expected_version:Number(body.expectedVersion||0),p_berater_number:beraterNumber,p_mandant_number:mandantNumber,p_regular_wage_type:regularWageType,p_mappings:mappings,p_actor_id:String(ctx.session.subject_id)});
  if(error){const message=String(error.message||"");if(message.includes("version_conflict"))fail("Die DATEV-Zuordnung wurde inzwischen geändert. Bitte aktualisieren.",409,"datev_config_version_conflict");if(message.includes("duplicate_datev_personnel_number"))fail("Eine DATEV-Personalnummer darf nur einem Mitarbeiter zugeordnet sein.",409,"duplicate_personnel_number");throw error}
  return status(ctx,{period});
}
async function createExport(ctx:any,body:any,origin:string|null){
  const period=monthValue(body.period);
  const mode=String(body.mode||"final");
  if(!["draft","final"].includes(mode))fail("Exportmodus ist ungültig.",400,"invalid_export_mode");
  const idempotencyKey=clean(body.idempotencyKey);
  if(!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey))fail("Export-ID fehlt.",400,"export_idempotency_missing");
  const settings=await settingsRow(ctx);
  if(!settings)fail("DATEV-Zuordnung ist noch nicht eingerichtet.",409,"datev_hours_settings_missing");
  let sourceRows:any[]=[],sourceEvidence:any={},sourceRevision:number|null=ctx.sourceRevision;
  if(mode==="draft"){
    const{scoped,summary}=hoursSummary(ctx,period),included=scoped.employees.filter((employee:any)=>{const totals=summary.get(String(employee.id));return totals&&(totals.minutes>0||totals.openEntries>0)});
    if(!included.length)fail("Für diesen Monat wurden keine Arbeitsstunden gefunden.",409,"datev_hours_empty");
    const open=included.filter((employee:any)=>Number(summary.get(String(employee.id))?.openEntries||0)>0);
    if(open.length)fail("Offene oder laufende Arbeitszeitbuchungen müssen vor dem DATEV-Entwurf abgeschlossen werden.",409,"datev_hours_open_entries",open.map((employee:any)=>clean(employee.name)));
    sourceRows=included.map((employee:any)=>({employeeId:String(employee.id),minutes:Number(summary.get(String(employee.id))?.minutes||0)})).filter(row=>row.minutes>0);
    sourceEvidence={workspaceRevision:ctx.sourceRevision,warning:"mutable_draft_not_payroll_final"};
  }else{
    const finalSnapshot=await finalPayrollSnapshot(ctx,period);
    if(!finalSnapshot.rows.length)fail("Für diesen Monat fehlen bestätigte Arbeitszeitnachweise.",409,"datev_final_snapshots_missing");
    const current=hoursSummary(ctx,period),requiredEmployeeIds=current.scoped.employees.filter((employee:any)=>{const totals=current.summary.get(String(employee.id));return totals&&(totals.minutes>0||totals.openEntries>0)}).map((employee:any)=>String(employee.id)),finalEmployeeIds=new Set(finalSnapshot.rows.map((row:any)=>row.employeeId)),missingApproved=requiredEmployeeIds.filter((id:string)=>!finalEmployeeIds.has(id));
    if(missingApproved.length)fail("Für alle Mitarbeiter mit Monatsstunden wird ein bestätigter Arbeitszeitnachweis benötigt.",409,"datev_final_snapshots_incomplete",missingApproved);
    if(finalSnapshot.invalidSnapshots.length)fail("Mindestens ein bestätigter Arbeitszeitnachweis hat die Integritätsprüfung nicht bestanden.",409,"datev_final_snapshot_invalid",finalSnapshot.invalidSnapshots);
    if(finalSnapshot.openDays)fail("Bestätigte Arbeitszeitnachweise enthalten noch offene Tage.",409,"datev_final_open_days");
    if(finalSnapshot.pendingCorrections.length)fail("Offene Zeitkorrekturen müssen vor dem finalen Export entschieden werden.",409,"datev_pending_corrections",finalSnapshot.pendingCorrections.map((row:any)=>String(row.id)));
    sourceRows=finalSnapshot.rows.filter((row:any)=>row.minutes>0);
    sourceRevision=null;
    sourceEvidence={submissionIds:finalSnapshot.rows.map((row:any)=>row.submissionId),submissionVersions:finalSnapshot.rows.map((row:any)=>({id:row.submissionId,version:row.submissionVersion})),snapshotHashes:finalSnapshot.rows.map((row:any)=>row.snapshotHash),signedHashes:finalSnapshot.rows.map((row:any)=>row.signedHash)};
  }
  if(!sourceRows.length)fail("Für diesen Monat wurden keine abgeschlossenen Arbeitsstunden gefunden.",409,"datev_hours_empty");
  const mappings=await mappingRows(ctx,sourceRows.map((row:any)=>row.employeeId));
  const mappingMap=new Map(mappings.map((row:any)=>[String(row.employee_id),datevPersonnelNumber(row.personnel_number)]));
  const missing=sourceRows.filter((row:any)=>!mappingMap.get(row.employeeId));
  if(missing.length)fail("Für alle Mitarbeiter mit Stunden wird eine DATEV-Personalnummer benötigt.",409,"datev_personnel_number_missing",missing.map((row:any)=>({id:row.employeeId})));
  const used=new Set<string>();
  for(const sourceRow of sourceRows){
    const personnel=mappingMap.get(sourceRow.employeeId)!;
    if(used.has(personnel))fail(`Personalnummer ${personnel} ist mehrfach zugeordnet.`,409,"duplicate_personnel_number");
    used.add(personnel);
  }
  const range=monthRange(period),exportRows=sourceRows.map((row:any)=>({personnel:mappingMap.get(row.employeeId)!,minutes:row.minutes})).sort((a,b)=>a.personnel.localeCompare(b.personnel,"de",{numeric:true})),rows=exportRows.map(row=>`3;${range.datev};${decimalComma(row.minutes/60)};01;${settings.regular_wage_type};${row.personnel};`);
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
  const sourceSnapshotHash=await sha256(new TextEncoder().encode(stableStringify({period,mode,sourceRows,sourceEvidence,configVersion:Number(settings.version||1)}))),totalMinutes=sourceRows.reduce((sum:number,row:any)=>sum+row.minutes,0);
  const{data:existing}=await service.from("datev_hours_export_runs").select("checksum_sha256,source_snapshot_hash").eq("organization_id",ctx.organization.id).eq("idempotency_key",idempotencyKey).maybeSingle();
  if(existing&&(existing.checksum_sha256!==checksum||existing.source_snapshot_hash!==sourceSnapshotHash))fail("Dieser Exportauftrag gehört zu einem anderen Datenstand.",409,"datev_export_idempotency_conflict");
  if(!existing){const{error:logError}=await service.from("datev_hours_export_runs").insert({organization_id:ctx.organization.id,period,target_system:"datev_lodas",row_count:rows.length,total_minutes:totalMinutes,checksum_sha256:checksum,created_by:String(ctx.session.subject_id),export_mode:mode,source_revision:sourceRevision,source_snapshot_hash:sourceSnapshotHash,config_version:Number(settings.version||1),idempotency_key:idempotencyKey,evidence:{...sourceEvidence,exportRows},metadata:{kind:"regular_hours_only",bookingKey:"01",wageType:settings.regular_wage_type,scope:ctx.accessRole,managerLocationIds:ctx.accessRole==="manager"?ctx.locationIds:[],validationStatus:"not_test_imported"}});if(logError)throw logError}
  const filename=`AORA_DATEV_LODAS_STUNDEN_${mode==="draft"?"ENTWURF_":""}${period}.txt`;
  return new Response(bytes,{status:200,headers:{...cors(origin),"Content-Type":"text/plain; charset=us-ascii","Content-Disposition":`attachment; filename=${filename}`,"X-Aora-Export-Checksum":checksum,"X-Aora-Export-Period":period,"X-Aora-Datev-Validation":"not-test-imported"}});
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
