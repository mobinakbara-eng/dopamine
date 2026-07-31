import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_WORKSPACE="aora-workforce";
const DEFAULT_ORIGIN="https://dopamine-blond.vercel.app";
const PREVIEW_SUFFIX="-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS=new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-mobins-projects-4f428afa.vercel.app",
  "https://aora-workforce.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-v8-hardening.vercel.app"
]);
const ITERATIONS=210000;
const MAX_BODY_BYTES=32_000;
const encoder=new TextEncoder();

class ApiError extends Error{
  status:number;
  code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code}
}

const hex=(bytes:Uint8Array)=>[...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
const fromHex=(value:string)=>Uint8Array.from(value.match(/.{1,2}/g)||[],part=>parseInt(part,16));
const randomHex=(length=32)=>hex(crypto.getRandomValues(new Uint8Array(length)));
async function digest(algorithm:string,value:string){return hex(new Uint8Array(await crypto.subtle.digest(algorithm,encoder.encode(value))))}
async function sha256(value:string){return digest("SHA-256",value)}
async function derive(password:string,salt:string,iterations=ITERATIONS){
  const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:fromHex(salt),iterations},key,256)));
}
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
  return new Response(JSON.stringify({request_id:requestId,data,error:null,server_time:new Date().toISOString()}),{
    status,
    headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}
  });
}
function failure(requestId:string,error:unknown,origin:string|null){
  const value=error instanceof ApiError?error:new ApiError(500,"internal_error",error instanceof Error?error.message:String(error));
  console.warn("aora-account-recovery-rejected",{requestId,status:value.status,code:value.code,message:value.message});
  return new Response(JSON.stringify({request_id:requestId,data:null,error:{code:value.code,message:value.message},server_time:new Date().toISOString()}),{
    status:value.status,
    headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}
  });
}
function clientIp(request:Request){
  return request.headers.get("cf-connecting-ip")
    ||request.headers.get("x-real-ip")
    ||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ||"unknown";
}
async function consumeRateLimit(request:Request,scope:string,identifier:string,limit=5,windowSeconds=900){
  const bucket=await sha256(`${scope}:${clientIp(request)}:${identifier}:${request.headers.get("user-agent")||""}`);
  const result=await service.rpc("aora_consume_rate_limit",{p_bucket:bucket,p_window_seconds:windowSeconds,p_limit:limit});
  if(result.error)throw new ApiError(500,"rate_limit_failed",result.error.message);
  const row=Array.isArray(result.data)?result.data[0]:result.data;
  if(!row?.allowed)throw new ApiError(429,"rate_limited",`Zu viele Anfragen. Bitte in ${Number(row?.retry_after_seconds||60)} Sekunden erneut versuchen.`);
}
async function organizationFor(slug:string){
  const normalized=slug.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(normalized))throw new ApiError(400,"invalid_workspace","Arbeitsbereich ist ungültig.");
  const result=await service.from("organizations").select("id,slug,name,status").eq("slug",normalized).eq("status","active").maybeSingle();
  if(result.error||!result.data)throw new ApiError(404,"workspace_not_found","Arbeitsbereich wurde nicht gefunden.");
  return result.data;
}
async function ownerContext(token:string){
  if(token.length!==64)throw new ApiError(401,"invalid_session","Sitzungstoken fehlt.");
  const session=await service.rpc("validate_demo_session",{p_token:token});
  if(session.error||!session.data?.length)throw new ApiError(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  const value=session.data[0];
  if(value.role!=="admin")throw new ApiError(403,"owner_required","Nur der Inhaber darf Kontowiederherstellungen verwalten.");
  const admin=await service.from("admins").select("id,payload,deleted_at").eq("organization_id",value.organization_id).eq("id",value.subject_id).maybeSingle();
  if(admin.error||!admin.data||admin.data.deleted_at||admin.data.payload?.scope!=="owner")throw new ApiError(403,"owner_required","Nur der Inhaber darf Kontowiederherstellungen verwalten.");
  const organization=await service.from("organizations").select("id,slug,name,status").eq("id",value.organization_id).eq("status","active").maybeSingle();
  if(organization.error||!organization.data)throw new ApiError(403,"workspace_inactive","Arbeitsbereich ist nicht aktiv.");
  return{session:value,organization:organization.data};
}
async function expireOldRequests(organizationId:string){
  await service.from("password_reset_requests").update({status:"expired",last_error:"Token expired"}).eq("organization_id",organizationId).eq("status","approved").lt("expires_at",new Date().toISOString());
}
async function accountName(organizationId:string,subjectRole:string,subjectId:string){
  const snapshot=await service.from("workspace_snapshots").select("state").eq("organization_id",organizationId).maybeSingle();
  if(snapshot.error||!snapshot.data)return"AoraAI Konto";
  const collection=subjectRole==="admin"?snapshot.data.state?.admins:snapshot.data.state?.employees;
  return collection?.find((item:any)=>String(item.id)===subjectId)?.name||"AoraAI Konto";
}
async function assertPasswordSafe(password:string){
  if(!(password.length>=10&&password.length<=128&&/[a-z]/.test(password)&&/[A-Z]/.test(password)&&/\d/.test(password))){
    throw new ApiError(400,"weak_password","Das Passwort benötigt mindestens 10 Zeichen, Groß- und Kleinbuchstaben sowie eine Zahl.");
  }
  const hash=(await digest("SHA-1",password)).toUpperCase();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6000);
  try{
    const response=await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0,5)}`,{
      headers:{"Add-Padding":"true","User-Agent":"Aora-Workforce-Production/8.1.0"},
      signal:controller.signal
    });
    if(!response.ok)throw new ApiError(503,"password_check_unavailable","Die sichere Passwortprüfung ist vorübergehend nicht verfügbar.");
    if((await response.text()).split(/\r?\n/).some(line=>line.split(":")[0]?.trim()===hash.slice(5))){
      throw new ApiError(400,"compromised_password","Dieses Passwort ist aus bekannten Datenlecks bekannt.");
    }
  }catch(error){
    if(error instanceof ApiError)throw error;
    throw new ApiError(503,"password_check_unavailable","Die sichere Passwortprüfung ist vorübergehend nicht verfügbar.");
  }finally{clearTimeout(timer)}
}

async function requestReset(request:Request,body:any){
  const email=String(body.email||"").trim().toLowerCase();
  const slug=String(body.workspaceSlug||DEFAULT_WORKSPACE);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,"invalid_email","Bitte eine gültige E-Mail-Adresse eingeben.");
  await consumeRateLimit(request,"password-reset",`${slug}:${email}`,5,900);
  let organization:any;
  try{organization=await organizationFor(slug)}catch(error){
    if(error instanceof ApiError&&error.status===404)return{accepted:true};
    throw error;
  }
  await expireOldRequests(organization.id);
  const credential=await service.from("aora_v8_final_credentials").select("subject_role,subject_id,email,active").eq("organization_id",organization.id).eq("email",email).eq("active",true).maybeSingle();
  if(credential.error||!credential.data)return{accepted:true};
  const requesterHash=await sha256(`${clientIp(request)}:${request.headers.get("user-agent")||""}`);
  const existing=await service.from("password_reset_requests").select("id,status").eq("organization_id",organization.id).eq("email",email).in("status",["pending","approved"]).maybeSingle();
  if(existing.data){
    const updated=await service.from("password_reset_requests").update({status:"pending",requested_at:new Date().toISOString(),approved_at:null,approved_by:null,token_hash:null,expires_at:null,requester_hash:requesterHash,last_error:null}).eq("id",existing.data.id);
    if(updated.error)throw new ApiError(500,"request_failed",updated.error.message);
  }else{
    const inserted=await service.from("password_reset_requests").insert({organization_id:organization.id,subject_role:credential.data.subject_role,subject_id:credential.data.subject_id,email,requester_hash:requesterHash,status:"pending"});
    if(inserted.error)throw new ApiError(500,"request_failed",inserted.error.message);
  }
  return{accepted:true};
}
async function requestSupport(request:Request,body:any){
  const email=String(body.email||"").trim().toLowerCase();
  const subject=String(body.subject||"").trim();
  const message=String(body.message||"").trim();
  const slug=String(body.workspaceSlug||DEFAULT_WORKSPACE);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,"invalid_email","Bitte eine gültige E-Mail-Adresse eingeben.");
  if(subject.length<3||subject.length>120)throw new ApiError(400,"invalid_subject","Bitte einen aussagekräftigen Betreff eingeben.");
  if(message.length<10||message.length>4000)throw new ApiError(400,"invalid_message","Die Nachricht muss zwischen 10 und 4000 Zeichen lang sein.");
  await consumeRateLimit(request,"support",`${slug}:${email}`,5,900);
  const organization=await organizationFor(slug);
  const requesterHash=await sha256(`${clientIp(request)}:${request.headers.get("user-agent")||""}`);
  const inserted=await service.from("support_requests").insert({organization_id:organization.id,email,subject,message,requester_hash:requesterHash,status:"open"}).select("id").single();
  if(inserted.error)throw new ApiError(500,"support_request_failed",inserted.error.message);
  return{accepted:true,requestId:inserted.data.id};
}
async function listRequests(body:any){
  const ctx=await ownerContext(String(body.token||""));
  await expireOldRequests(ctx.organization.id);
  const[resets,support]=await Promise.all([
    service.from("password_reset_requests").select("id,email,subject_role,subject_id,status,requested_at,approved_at,expires_at").eq("organization_id",ctx.organization.id).in("status",["pending","approved"]).order("requested_at",{ascending:false}),
    service.from("support_requests").select("id,email,subject,message,status,created_at").eq("organization_id",ctx.organization.id).eq("status","open").order("created_at",{ascending:false})
  ]);
  if(resets.error)throw new ApiError(500,"database_error",resets.error.message);
  if(support.error)throw new ApiError(500,"database_error",support.error.message);
  return{passwordResets:resets.data||[],supportRequests:support.data||[]};
}
async function approveReset(body:any){
  const ctx=await ownerContext(String(body.token||""));
  const requestId=String(body.requestId||"");
  await expireOldRequests(ctx.organization.id);
  const reset=await service.from("password_reset_requests").select("*").eq("organization_id",ctx.organization.id).eq("id",requestId).in("status",["pending","approved"]).maybeSingle();
  if(reset.error||!reset.data)throw new ApiError(404,"request_not_found","Reset-Anfrage wurde nicht gefunden.");
  const rawToken=randomHex(32);
  const expiresAt=new Date(Date.now()+30*60*1000).toISOString();
  const updated=await service.from("password_reset_requests").update({status:"approved",approved_at:new Date().toISOString(),approved_by:ctx.session.subject_id,token_hash:await sha256(rawToken),expires_at:expiresAt,last_error:null}).eq("id",requestId);
  if(updated.error)throw new ApiError(500,"approval_failed",updated.error.message);
  const resetUrl=new URL("reset-password/",DEFAULT_ORIGIN+"/");
  resetUrl.searchParams.set("workspace",ctx.organization.slug);
  resetUrl.searchParams.set("request",requestId);
  resetUrl.searchParams.set("token",rawToken);
  const name=await accountName(ctx.organization.id,reset.data.subject_role,reset.data.subject_id);
  return{requestId,expiresAt,delivery:{name,email:reset.data.email,resetUrl:resetUrl.toString(),subject:"AoraAI Passwort zurücksetzen",body:`Hallo ${name},\n\nüber diesen einmaligen Link kannst du dein AoraAI-Passwort innerhalb von 30 Minuten neu setzen:\n\n${resetUrl.toString()}\n\nFalls du die Anfrage nicht gestellt hast, ignoriere diese Nachricht.`}};
}
async function cancelReset(body:any){
  const ctx=await ownerContext(String(body.token||""));
  const requestId=String(body.requestId||"");
  const updated=await service.from("password_reset_requests").update({status:"cancelled",cancelled_at:new Date().toISOString(),token_hash:null}).eq("organization_id",ctx.organization.id).eq("id",requestId).in("status",["pending","approved"]).select("id").maybeSingle();
  if(updated.error||!updated.data)throw new ApiError(404,"request_not_found","Reset-Anfrage wurde nicht gefunden.");
  return{requestId,cancelled:true};
}
async function closeSupport(body:any){
  const ctx=await ownerContext(String(body.token||""));
  const requestId=String(body.requestId||"");
  const updated=await service.from("support_requests").update({status:"closed",closed_at:new Date().toISOString(),closed_by:ctx.session.subject_id}).eq("organization_id",ctx.organization.id).eq("id",requestId).eq("status","open").select("id").maybeSingle();
  if(updated.error||!updated.data)throw new ApiError(404,"request_not_found","Support-Anfrage wurde nicht gefunden.");
  return{requestId,closed:true};
}
async function resetPassword(request:Request,body:any){
  const requestId=String(body.requestId||"");
  const token=String(body.resetToken||"");
  const password=String(body.password||"");
  if(!/^[0-9a-f]{64}$/i.test(token))throw new ApiError(401,"invalid_reset_token","Reset-Link ist ungültig oder abgelaufen.");
  await consumeRateLimit(request,"password-reset-complete",requestId,10,900);
  const resetContext=await service.from("password_reset_requests").select("organization_id").eq("id",requestId).maybeSingle();
  if(resetContext.error||!resetContext.data)throw new ApiError(401,"invalid_reset_token","Reset-Link ist ungültig oder abgelaufen.");
  await assertPasswordSafe(password);
  const salt=randomHex(16);
  const completed=await service.rpc("aora_complete_password_reset",{p_request_id:requestId,p_token_hash:await sha256(token),p_salt:salt,p_password_hash:await derive(password,salt),p_iterations:ITERATIONS});
  if(completed.error){
    const message=String(completed.error.message||"");
    if(/expired|not_active|invalid|not_found/.test(message))throw new ApiError(401,"invalid_reset_token","Reset-Link ist ungültig oder abgelaufen.");
    throw new ApiError(500,"reset_failed",message);
  }
  const account=completed.data?.[0];
  let accessRole=account?.subject_role==="employee"?"employee":"manager";
  if(account?.subject_role==="admin"){
    const admin=await service.from("admins").select("payload").eq("organization_id",resetContext.data.organization_id).eq("id",account.subject_id).maybeSingle();
    if(admin.data?.payload?.scope==="owner")accessRole="owner";
  }
  return{completed:true,accessRole};
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
    let data:unknown;
    switch(action){
      case"requestReset":data=await requestReset(request,body);return success(requestId,data,origin,202);
      case"requestSupport":data=await requestSupport(request,body);return success(requestId,data,origin,202);
      case"listRequests":data=await listRequests(body);break;
      case"approveReset":data=await approveReset(body);break;
      case"cancelReset":data=await cancelReset(body);break;
      case"closeSupport":data=await closeSupport(body);break;
      case"resetPassword":data=await resetPassword(request,body);break;
      case"health":data={ok:true,service:"aora-v8-account-recovery"};break;
      default:throw new ApiError(400,"unknown_action","Unbekannte Aktion.");
    }
    return success(requestId,data,origin);
  }catch(error){
    return failure(requestId,error,origin);
  }
});
