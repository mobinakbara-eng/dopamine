import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
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
const MAX_FILE_BYTES=15*1024*1024;
const BUCKET="checklist-evidence";
const MANAGER_ITEM="__aora_manager_reference__";
const EMPLOYEE_ITEM="__aora_employee_photo__";

class ApiError extends Error{
  status:number;
  code:string;
  details?:unknown;
  constructor(status:number,code:string,message:string,details?:unknown){super(message);this.status=status;this.code=code;this.details=details}
}
const now=()=>new Date().toISOString();
const asInt=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Math.trunc(Number(value)):fallback;
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
function response(requestId:string,data:unknown,error:unknown,status:number,origin:string|null){
  return new Response(JSON.stringify({request_id:requestId,data,error,server_time:now()}),{status,headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}})
}
function ok(requestId:string,data:unknown,origin:string|null,status=200){return response(requestId,data,null,status,origin)}
function failResponse(requestId:string,error:unknown,origin:string|null){
  const value=error instanceof ApiError?error:new ApiError(500,"internal_error",error instanceof Error?error.message:String(error));
  console.warn("aora-task-media-rejected",{requestId,status:value.status,code:value.code,message:value.message});
  return response(requestId,null,{code:value.code,message:value.message,details:value.details||null},value.status,origin)
}
async function one<T=any>(query:PromiseLike<any>,message:string){
  const{data,error}=await query;
  if(error)throw new ApiError(500,"database_error",error.message);
  if(!data)throw new ApiError(404,"not_found",message);
  return data as T
}
async function sessionFor(token:string){
  if(token.length!==64)throw new ApiError(401,"invalid_session","Sitzungstoken fehlt.");
  const{data,error}=await service.rpc("validate_demo_session",{p_token:token});
  if(error||!data?.length)throw new ApiError(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  const session=data[0];
  const organization=await one(service.from("organizations").select("id,status").eq("id",session.organization_id).eq("status","active").maybeSingle(),"Organisation ist nicht aktiv.");
  let accessRole=String(session.role||"");
  let locationIds:string[]=[];
  if(session.role==="admin"){
    const admin=await one(service.from("admins").select("id,payload,deleted_at").eq("organization_id",organization.id).eq("id",session.subject_id).maybeSingle(),"Administrationszugang wurde deaktiviert.");
    if(admin.deleted_at)throw new ApiError(403,"admin_inactive","Administrationszugang wurde deaktiviert.");
    accessRole=admin.payload?.scope==="owner"?"owner":"manager";
    if(accessRole==="owner"){
      const rows=await service.from("locations").select("id").eq("organization_id",organization.id).eq("active",true).is("deleted_at",null);
      if(rows.error)throw new ApiError(500,"database_error",rows.error.message);
      locationIds=(rows.data||[]).map((row:any)=>String(row.id));
    }else{
      const rows=await service.from("manager_location_access").select("location_id").eq("organization_id",organization.id).eq("manager_id",session.subject_id);
      if(rows.error)throw new ApiError(500,"database_error",rows.error.message);
      locationIds=(rows.data||[]).map((row:any)=>String(row.location_id));
    }
  }else if(session.role==="employee"){
    const employee=await one(service.from("employees").select("id,location_id,primary_location_id,active,deleted_at").eq("organization_id",organization.id).eq("id",session.subject_id).maybeSingle(),"Mitarbeiter wurde nicht gefunden.");
    if(!employee.active||employee.deleted_at)throw new ApiError(403,"employee_inactive","Mitarbeiterkonto ist deaktiviert.");
    const rows=await service.from("employee_location_access").select("location_id").eq("organization_id",organization.id).eq("employee_id",session.subject_id);
    if(rows.error)throw new ApiError(500,"database_error",rows.error.message);
    locationIds=[...new Set([employee.location_id,employee.primary_location_id,...(rows.data||[]).map((row:any)=>row.location_id)].filter(Boolean).map(String))];
  }else throw new ApiError(403,"role_forbidden","Diese Rolle darf Aufgabenmedien nicht verwenden.");
  return{session,organizationId:String(organization.id),accessRole,locationIds}
}
function requireRole(ctx:any,roles:string[]){if(!roles.includes(String(ctx.accessRole)))throw new ApiError(403,"forbidden","Für diese Aktion fehlt die Berechtigung.")}
function requireLocation(ctx:any,locationId:string){if(!ctx.locationIds.includes(String(locationId)))throw new ApiError(403,"location_forbidden","Kein Zugriff auf diesen Standort.")}
async function taskAccess(ctx:any,taskId:string){
  if(!taskId)throw new ApiError(400,"task_required","Aufgabe fehlt.");
  const task=await one(service.from("task_instances").select("id,organization_id,location_id,status,payload,version,deleted_at").eq("organization_id",ctx.organizationId).eq("id",taskId).is("deleted_at",null).maybeSingle(),"Aufgabe wurde nicht gefunden.");
  requireLocation(ctx,String(task.location_id));
  if(ctx.accessRole==="employee"){
    const assignment=await service.from("task_assignments").select("employee_id,status").eq("organization_id",ctx.organizationId).eq("task_instance_id",taskId).eq("employee_id",ctx.session.subject_id).maybeSingle();
    if(assignment.error)throw new ApiError(500,"database_error",assignment.error.message);
    if(!assignment.data||assignment.data.status==="cancelled")throw new ApiError(403,"task_forbidden","Diese Aufgabe ist dir nicht zugewiesen.");
  }
  return task
}
function mediaKind(value:unknown){
  const kind=String(value||"");
  if(!["manager_reference","employee_proof"].includes(kind))throw new ApiError(400,"invalid_media_kind","Fotoart ist ungültig.");
  return kind
}
function itemFor(kind:string){return kind==="manager_reference"?MANAGER_ITEM:EMPLOYEE_ITEM}
function validateMediaRole(ctx:any,kind:string){
  if(kind==="manager_reference")requireRole(ctx,["owner","manager"]);
  else requireRole(ctx,["employee"])
}
function validImage(body:any){
  const mimeType=String(body.mimeType||"");
  const fileSize=asInt(body.fileSize,0);
  if(!new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]).has(mimeType))throw new ApiError(400,"invalid_photo_type","Bitte JPG, PNG, WebP oder HEIC verwenden.");
  if(fileSize<=0||fileSize>MAX_FILE_BYTES)throw new ApiError(400,"invalid_photo_size","Das Foto darf maximal 15 MB groß sein.");
  const rawExt=String(body.extension||"").replace(/[^a-z0-9]/gi,"").toLowerCase();
  const extension=rawExt||({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic","image/heif":"heif"} as Record<string,string>)[mimeType]||"jpg";
  return{mimeType,fileSize,extension}
}
async function configure(ctx:any,body:any){
  requireRole(ctx,["owner","manager"]);
  const taskIds=[...new Set<string>((Array.isArray(body.taskIds)?body.taskIds:[]).map((value:unknown)=>String(value)).filter(Boolean))];
  if(!taskIds.length||taskIds.length>50)throw new ApiError(400,"invalid_task_ids","Zwischen 1 und 50 Aufgaben sind erforderlich.");
  const required=body.photoEvidenceRequired===true||String(body.photoEvidenceRequired).toLowerCase()==="true";
  for(const taskId of taskIds){
    const task=await taskAccess(ctx,taskId);
    const updated=await service.from("task_instances").update({payload:{...(task.payload||{}),photoEvidenceRequired:required},version:Number(task.version||0)+1,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",taskId).eq("version",task.version).select("id").maybeSingle();
    if(updated.error||!updated.data)throw new ApiError(409,"version_conflict",updated.error?.message||"Aufgabe wurde parallel geändert.");
  }
  return{taskIds,photoEvidenceRequired:required}
}
async function prepareUpload(ctx:any,body:any){
  const kind=mediaKind(body.kind);
  validateMediaRole(ctx,kind);
  const task=await taskAccess(ctx,String(body.taskId||""));
  const media=validImage(body);
  const itemId=itemFor(kind);
  const path=`${ctx.organizationId}/${task.location_id}/${task.id}/${itemId}/${crypto.randomUUID()}.${media.extension}`;
  const signed=await service.storage.from(BUCKET).createSignedUploadUrl(path);
  if(signed.error)throw new ApiError(500,"signed_upload_failed",signed.error.message);
  return{bucket:BUCKET,path,signedUrl:signed.data.signedUrl,token:signed.data.token,kind,itemId}
}
async function confirmUpload(ctx:any,body:any){
  const kind=mediaKind(body.kind);
  validateMediaRole(ctx,kind);
  const task=await taskAccess(ctx,String(body.taskId||""));
  const media=validImage(body);
  const itemId=itemFor(kind);
  const path=String(body.path||"");
  const prefix=`${ctx.organizationId}/${task.location_id}/${task.id}/${itemId}/`;
  if(!path.startsWith(prefix))throw new ApiError(403,"media_path_forbidden","Dateipfad gehört nicht zu dieser Aufgabe.");
  const parts=path.split("/");
  const fileName=parts.pop()||"";
  const folder=parts.join("/");
  const listed=await service.storage.from(BUCKET).list(folder,{search:fileName,limit:10});
  if(listed.error||!(listed.data||[]).some((item:any)=>item.name===fileName))throw new ApiError(409,"upload_missing","Der Upload konnte nicht bestätigt werden.");
  const inserted=await service.from("task_evidence").insert({
    organization_id:ctx.organizationId,
    location_id:task.location_id,
    task_instance_id:task.id,
    template_item_id:itemId,
    uploaded_by:ctx.session.subject_id,
    storage_path:path,
    mime_type:media.mimeType,
    file_size:media.fileSize,
    sha256:String(body.sha256||""),
    captured_at:body.capturedAt||null
  }).select("id,uploaded_at").single();
  if(inserted.error)throw new ApiError(500,"media_confirm_failed",inserted.error.message);
  return{evidenceId:inserted.data.id,uploadedAt:inserted.data.uploaded_at,kind}
}
async function listMedia(ctx:any,body:any){
  const task=await taskAccess(ctx,String(body.taskId||""));
  const rows=await service.from("task_evidence").select("id,template_item_id,mime_type,file_size,uploaded_by,uploaded_at,captured_at").eq("organization_id",ctx.organizationId).eq("task_instance_id",task.id).in("template_item_id",[MANAGER_ITEM,EMPLOYEE_ITEM]).is("deleted_at",null).order("uploaded_at",{ascending:true});
  if(rows.error)throw new ApiError(500,"database_error",rows.error.message);
  return(rows.data||[]).filter((row:any)=>ctx.accessRole!=="employee"||String(row.template_item_id)===MANAGER_ITEM||String(row.uploaded_by)===String(ctx.session.subject_id)).map((row:any)=>({id:row.id,kind:String(row.template_item_id)===MANAGER_ITEM?"manager_reference":"employee_proof",mimeType:row.mime_type,fileSize:row.file_size,uploadedAt:row.uploaded_at,capturedAt:row.captured_at,own:String(row.uploaded_by)===String(ctx.session.subject_id)}))
}
async function viewMedia(ctx:any,body:any){
  const task=await taskAccess(ctx,String(body.taskId||""));
  const evidence=await one(service.from("task_evidence").select("id,template_item_id,uploaded_by,storage_path,mime_type").eq("organization_id",ctx.organizationId).eq("task_instance_id",task.id).eq("id",String(body.evidenceId||"")).is("deleted_at",null).maybeSingle(),"Foto wurde nicht gefunden.");
  if(![MANAGER_ITEM,EMPLOYEE_ITEM].includes(String(evidence.template_item_id)))throw new ApiError(403,"media_forbidden","Dieses Dokument ist kein Aufgabenfoto.");
  if(ctx.accessRole==="employee"&&String(evidence.template_item_id)===EMPLOYEE_ITEM&&String(evidence.uploaded_by)!==String(ctx.session.subject_id))throw new ApiError(403,"media_forbidden","Dieses Foto gehört zu einem anderen Mitarbeiter.");
  const signed=await service.storage.from(BUCKET).createSignedUrl(String(evidence.storage_path),600);
  if(signed.error)throw new ApiError(500,"signed_view_failed",signed.error.message);
  return{url:signed.data.signedUrl,mimeType:evidence.mime_type,expiresIn:600}
}
async function submitTask(ctx:any,body:any){
  requireRole(ctx,["employee"]);
  const task=await taskAccess(ctx,String(body.taskId||""));
  if(task.payload?.photoEvidenceRequired===true){
    const proof=await service.from("task_evidence").select("id").eq("organization_id",ctx.organizationId).eq("task_instance_id",task.id).eq("template_item_id",EMPLOYEE_ITEM).eq("uploaded_by",ctx.session.subject_id).is("deleted_at",null).limit(1);
    if(proof.error)throw new ApiError(500,"database_error",proof.error.message);
    if(!(proof.data||[]).length)throw new ApiError(422,"photo_evidence_required","Bitte zuerst ein Foto als Nachweis hochladen.");
  }
  const upstream=await fetch(`${SUPABASE_URL}/functions/v1/aora-v8-domain-api-compat`,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${SERVICE_KEY}`,"apikey":SERVICE_KEY},body:JSON.stringify({action:"submitTask",token:String(body.token||""),taskId:task.id})});
  const text=await upstream.text();
  let envelope:any={};
  try{envelope=text?JSON.parse(text):{}}catch{throw new ApiError(502,"invalid_upstream_response","Aufgabe konnte nicht abgeschlossen werden.")}
  if(!upstream.ok||envelope?.error)throw new ApiError(upstream.status||500,String(envelope?.error?.code||"submit_failed"),String(envelope?.error?.message||"Aufgabe konnte nicht abgeschlossen werden."),envelope?.error?.details||null);
  return envelope?.data
}

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("origin");
  const requestId=request.headers.get("x-request-id")||crypto.randomUUID();
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST")return failResponse(requestId,new ApiError(405,"method_not_allowed","Method not allowed"),origin);
  if(origin&&!allowedOrigin(origin))return failResponse(requestId,new ApiError(403,"origin_forbidden","Origin not allowed"),origin);
  try{
    const text=await request.text();
    if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)throw new ApiError(413,"request_too_large","Request too large");
    const body=text?JSON.parse(text):{};
    const ctx=await sessionFor(String(body.token||""));
    let data:unknown;
    switch(String(body.action||"")){
      case"configure":data=await configure(ctx,body);break;
      case"prepareUpload":data=await prepareUpload(ctx,body);break;
      case"confirmUpload":data=await confirmUpload(ctx,body);break;
      case"listMedia":data=await listMedia(ctx,body);break;
      case"viewMedia":data=await viewMedia(ctx,body);break;
      case"submitTask":data=await submitTask(ctx,body);break;
      default:throw new ApiError(400,"unknown_action","Unbekannte Medienaktion.");
    }
    return ok(requestId,data,origin)
  }catch(error){return failResponse(requestId,error,origin)}
});
