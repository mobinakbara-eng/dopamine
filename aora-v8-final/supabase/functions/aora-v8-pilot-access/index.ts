import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OLD=`${URL}/functions/v1/aora-v8-hardening-access`;
const WORKSPACE="aora-v8-hardening-demo";
const ITERATIONS=210000;
const service=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
const fromHex=(v:string)=>Uint8Array.from(v.match(/.{1,2}/g)||[],x=>parseInt(x,16));
const randomHex=(n=32)=>hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(v:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))))}
async function derive(password:string,salt:string){const k=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);return hex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:fromHex(salt),iterations:ITERATIONS},k,256)))}
function allowedOrigin(origin:string|null){if(!origin)return true;try{const u=new URL(origin);return ["localhost","127.0.0.1"].includes(u.hostname)||u.hostname.endsWith("-mobins-projects-4f428afa.vercel.app")||["aora-v8-hardening.vercel.app","aora-v8-final.vercel.app","aora-workforce.vercel.app"].includes(u.hostname)}catch{return false}}
function headers(origin:string|null){return{"Access-Control-Allow-Origin":origin&&allowedOrigin(origin)?origin:"https://aora-v8-hardening.vercel.app","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","Vary":"Origin"}}
function reply(body:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(body),{status,headers:headers(origin)})}
function validPassword(v:string){return v.length>=10&&v.length<=128&&/[a-z]/.test(v)&&/[A-Z]/.test(v)&&/\d/.test(v)}
async function forward(body:unknown,origin:string|null){const r=await fetch(OLD,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${KEY}`,apikey:KEY,...(origin?{origin}:{})},body:JSON.stringify(body)});return new Response(r.body,{status:r.status,headers:{...headers(origin),"x-aora-pilot-access":"proxy"}})}
async function activate(body:any,origin:string|null){
 const invitationId=String(body.invitationId||""),token=String(body.token||""),email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
 if(token.length!==64||!validPassword(password))return reply({error:"Einladung oder Passwort ist ungültig."},400,origin);
 const {data:org,error:oe}=await service.from("organizations").select("id").eq("slug",WORKSPACE).eq("status","active").single();
 if(oe||!org)return reply({error:"Arbeitsbereich wurde nicht gefunden."},404,origin);
 const {data:snapshot,error:se}=await service.from("workspace_snapshots").select("state,revision").eq("organization_id",org.id).single();
 if(se||!snapshot)return reply({error:"Arbeitsbereich konnte nicht geladen werden."},404,origin);
 const invitation=(snapshot.state?.invitations||[]).find((x:any)=>x.id===invitationId&&x.status==="pending");
 const admin=(snapshot.state?.admins||[]).find((x:any)=>x.id===invitation?.subjectId);
 const employee=(snapshot.state?.employees||[]).find((x:any)=>x.id===invitation?.subjectId);
 const subject=admin||employee;
 if(!invitation||!subject||String(invitation.email||"").toLowerCase()!==email||new Date(invitation.expiresAt)<=new Date())return reply({error:"Einladung ist ungültig oder abgelaufen."},401,origin);
 const {data:tokenRow,error:te}=await service.from("aora_v8_final_invitation_tokens").select("token_hash,expires_at,used_at,revoked_at").eq("organization_id",org.id).eq("invitation_id",invitationId).maybeSingle();
 const tokenHash=await sha256(token);
 if(te||!tokenRow||tokenRow.used_at||tokenRow.revoked_at||new Date(tokenRow.expires_at)<=new Date()||String(tokenRow.token_hash).trim().toLowerCase()!==tokenHash)return reply({error:"Einladung ist ungültig oder abgelaufen."},401,origin);
 const role=admin?"admin":"employee",accessRole=admin?(admin.scope==="owner"?"owner":"manager"):"employee",locationId=admin?(admin.locationIds?.[0]||admin.locationId||null):(employee.locationId||null);
 const acceptedAt=new Date().toISOString(),state=structuredClone(snapshot.state);
 state.invitations=(state.invitations||[]).map((x:any)=>x.id===invitationId?{...x,status:"accepted",acceptedAt,emailStatus:"delivered"}:x);
 if(admin)state.admins=(state.admins||[]).map((x:any)=>x.id===admin.id?{...x,active:true,status:"active",acceptedAt}:x);
 else state.employees=(state.employees||[]).map((x:any)=>x.id===employee.id?{...x,active:true,status:"active",acceptedAt}:x);
 const salt=randomHex(16),passwordHash=await derive(password,salt),sessionToken=randomHex(32),sessionHash=await sha256(sessionToken);
 const {data,error}=await service.rpc("aora_activate_invitation_atomic",{p_organization_id:org.id,p_expected_revision:Number(snapshot.revision),p_invitation_id:invitationId,p_token_hash:tokenHash,p_subject_role:role,p_subject_id:subject.id,p_email:email,p_salt:salt,p_password_hash:passwordHash,p_iterations:ITERATIONS,p_state:state,p_session_token_hash:sessionHash,p_session_location_id:locationId,p_session_ttl_seconds:43200});
 if(error){const m=String(error.message||"");return reply({error:m.includes("invitation_invalid")?"Einladung ist ungültig oder abgelaufen.":m.includes("revision_conflict")?"Einladung wurde parallel geändert. Bitte neu öffnen.":"Aktivierung fehlgeschlagen."},m.includes("invitation_invalid")?401:m.includes("revision_conflict")?409:500,origin)}
 const expiresAt=data?.[0]?.session_expires_at;
 return reply({token:sessionToken,organizationId:org.id,role,accessRole,subjectId:subject.id,employeeId:role==="employee"?subject.id:null,adminId:role==="admin"?subject.id:null,locationId,expiresAt},200,origin);
}
Deno.serve(async req=>{const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});if(req.method!=="POST")return reply({error:"Method not allowed"},405,origin);if(origin&&!allowedOrigin(origin))return reply({error:"Origin not allowed"},403,origin);try{const body=await req.json();return body.action==="acceptInvitation"?await activate(body,origin):await forward(body,origin)}catch(e){return reply({error:String(e instanceof Error?e.message:e)},500,origin)}});