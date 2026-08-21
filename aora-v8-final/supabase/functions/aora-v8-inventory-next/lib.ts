import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.4";

export const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
export const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
export const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export const MAX_BODY_BYTES=96_000;
export const FULL_PERMISSIONS=["view","receipt","consume","waste","transfer_dispatch","transfer_receive","adjust","procurement"] as const;
const DEFAULT_ORIGIN="https://dopamine-blond.vercel.app";
const ORIGINS=new Set([DEFAULT_ORIGIN,"https://aora-workforce.vercel.app","https://aora-v8-final.vercel.app","https://aora-ipad-staging-public.vercel.app","https://aora-ipad-staging-final.vercel.app"]);
for(const value of String(Deno.env.get("AORA_ALLOWED_ORIGINS")||"").split(",").map(v=>v.trim()).filter(Boolean)){
  try{ORIGINS.add(new URL(value).origin)}catch{/* invalid env value ignored */}
}

export class ApiError extends Error{status:number;code:string;constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code}}
export function fail(status:number,code:string,message:string):never{throw new ApiError(status,code,message)}
export const now=()=>new Date().toISOString();
export function allowedOrigin(origin:string|null){if(!origin)return true;try{const u=new URL(origin);return ORIGINS.has(u.origin)||(["localhost","127.0.0.1"].includes(u.hostname)&&u.protocol==="http:")}catch{return false}}
export function cors(origin:string|null){return{"access-control-allow-origin":origin&&allowedOrigin(origin)?origin:DEFAULT_ORIGIN,"access-control-allow-headers":"authorization,x-client-info,apikey,content-type,x-request-id","access-control-allow-methods":"POST,OPTIONS","access-control-max-age":"600",vary:"Origin"}}
export function json(body:unknown,status:number,origin:string|null,requestId:string){return new Response(JSON.stringify(body),{status,headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-request-id":requestId}})}
export function dbFail(error:any,operation:string,requestId:string):never{console.error("aora-inventory-db",{requestId,operation,message:error?.message||String(error)});return fail(500,"database_error","Die Aktion konnte nicht abgeschlossen werden.")}
export function asUuid(value:unknown,code="id"){const v=String(value||"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))fail(400,`${code}_invalid`,"Ungültige Kennung.");return v}
export function idem(value:unknown){const v=String(value||"").trim();if(v.length<8||v.length>180)fail(400,"idempotency_invalid","Sichere Buchungskennung fehlt.");return v}
export function positive(value:unknown,max=1_000_000_000){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>max)fail(400,"quantity_invalid","Bitte eine gültige Menge eingeben.");return n}
export function email(value:unknown){const v=String(value||"").trim();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:""}
export function phoneDigits(value:unknown){return String(value||"").replace(/[^0-9]/g,"")}
export const encoder=new TextEncoder();
export async function sha256Hex(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))),b=>b.toString(16).padStart(2,"0")).join("")}
export function qrToken(){const bytes=crypto.getRandomValues(new Uint8Array(24));return`A1.k1.${btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}`}
export function shortCode(){const bytes=crypto.getRandomValues(new Uint8Array(6));return Array.from(bytes,b=>(b%36).toString(36).toUpperCase()).join("").replace(/(.{4})/g,"$1-").replace(/-$/,"")}

export type InventoryContext={organizationId:string;organizationName:string;subjectId:string;accessRole:"owner"|"manager"|"employee";locationIds:string[];token:string};

export async function sessionContext(token:string,requestId:string):Promise<InventoryContext>{
  if(token.length!==64)fail(401,"invalid_session","Sitzungstoken fehlt.");
  const{data:sessions,error}=await db.rpc("validate_demo_session",{p_token:token});
  if(error||!sessions?.length)fail(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  const session=sessions[0];
  const{data:org,error:orgError}=await db.from("organizations").select("id,status,name").eq("id",session.organization_id).eq("status","active").maybeSingle();
  if(orgError)dbFail(orgError,"load_organization",requestId);if(!org)fail(403,"organization_inactive","Organisation ist nicht aktiv.");
  if(session.role==="admin"){
    const{data:admin,error:adminError}=await db.from("admins").select("id,payload,deleted_at").eq("organization_id",org.id).eq("id",session.subject_id).is("deleted_at",null).maybeSingle();
    if(adminError)dbFail(adminError,"load_admin",requestId);if(!admin||admin.payload?.active===false||String(admin.payload?.status||"")==="revoked")fail(403,"admin_inactive","Administrationszugang wurde deaktiviert.");
    const accessRole=admin.payload?.scope==="owner"?"owner":"manager";
    if(accessRole==="owner"){
      const{data,error}=await db.from("locations").select("id").eq("organization_id",org.id).eq("active",true).is("deleted_at",null);if(error)dbFail(error,"owner_locations",requestId);
      return{organizationId:String(org.id),organizationName:String(org.name||"Aora"),subjectId:String(session.subject_id),accessRole,locationIds:(data||[]).map((r:any)=>String(r.id)),token};
    }
    const{data,error:accessError}=await db.from("manager_location_access").select("location_id").eq("organization_id",org.id).eq("manager_id",session.subject_id);if(accessError)dbFail(accessError,"manager_locations",requestId);
    return{organizationId:String(org.id),organizationName:String(org.name||"Aora"),subjectId:String(session.subject_id),accessRole:"manager",locationIds:(data||[]).map((r:any)=>String(r.location_id)),token};
  }
  if(session.role==="employee"){
    const{data:employee,error:employeeError}=await db.from("employees").select("id,location_id,primary_location_id,active,deleted_at").eq("organization_id",org.id).eq("id",session.subject_id).maybeSingle();
    if(employeeError)dbFail(employeeError,"load_employee",requestId);if(!employee||!employee.active||employee.deleted_at)fail(403,"employee_inactive","Mitarbeiterzugang wurde deaktiviert.");
    const{data:rows,error:rowsError}=await db.from("employee_location_access").select("location_id").eq("organization_id",org.id).eq("employee_id",session.subject_id);if(rowsError)dbFail(rowsError,"employee_locations",requestId);
    const locationIds=[...new Set([employee.primary_location_id,employee.location_id,...(rows||[]).map((r:any)=>r.location_id)].filter(Boolean).map(String))];
    return{organizationId:String(org.id),organizationName:String(org.name||"Aora"),subjectId:String(session.subject_id),accessRole:"employee",locationIds,token};
  }
  return fail(403,"inventory_forbidden","Bestand ist für diesen Zugang nicht freigeschaltet.");
}

export function requireLocation(ctx:InventoryContext,locationId:string){if(!locationId||!ctx.locationIds.includes(locationId))fail(403,"location_forbidden","Für diesen Standort fehlt die Berechtigung.")}
export async function hasPermission(ctx:InventoryContext,locationId:string,permission:string,requestId:string){
  if(ctx.accessRole==="owner")return true;
  const subjectType=ctx.accessRole==="manager"?"admin":"employee";
  const{data,error}=await db.from("inventory_permission_grants").select("permission").eq("organization_id",ctx.organizationId).eq("subject_type",subjectType).eq("subject_id",ctx.subjectId).eq("location_id",locationId).eq("permission",permission).maybeSingle();
  if(error)dbFail(error,"inventory_permission",requestId);return Boolean(data);
}
export async function requirePermission(ctx:InventoryContext,locationId:string,permission:string,requestId:string){requireLocation(ctx,locationId);if(!await hasPermission(ctx,locationId,permission,requestId))fail(403,"inventory_permission_forbidden","Für diese Bestandsfunktion fehlt die Berechtigung.")}
export async function featureEnabled(ctx:InventoryContext,key:string,locationId:string|null,requestId:string){
  const{data,error}=await db.from("feature_flags").select("location_id,enabled").eq("organization_id",ctx.organizationId).eq("flag_key",key);if(error)dbFail(error,`feature_${key}`,requestId);
  const local=(data||[]).find((r:any)=>String(r.location_id||"")===String(locationId||""));const global=(data||[]).find((r:any)=>r.location_id==null);return Boolean((local||global)?.enabled);
}
export async function requireFeature(ctx:InventoryContext,key:string,locationId:string,requestId:string){if(!await featureEnabled(ctx,key,locationId,requestId))fail(404,"feature_disabled","Diese Funktion ist für diesen Betrieb noch nicht freigeschaltet.")}
