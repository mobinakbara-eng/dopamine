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

type PermissionRow={locationId:string;permission:string};
type FeatureRow={key:string;locationId:string|null;enabled:boolean};
export type InventoryContext={organizationId:string;organizationName:string;subjectId:string;accessRole:"owner"|"manager"|"employee";locationIds:string[];permissions:PermissionRow[];features:FeatureRow[];token:string};

export async function sessionContext(token:string,requestId:string):Promise<InventoryContext>{
  if(token.length!==64)fail(401,"invalid_session","Sitzungstoken fehlt.");
  const{data:resolved,error}=await db.rpc("aora_inventory_resolve_session",{p_token:token});
  if(error)dbFail(error,"resolve_inventory_session",requestId);
  const status=String(resolved?.status||"");
  if(status==="invalid_session"||!status)fail(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  if(status==="organization_inactive")fail(403,"organization_inactive","Organisation ist nicht aktiv.");
  if(status==="admin_inactive")fail(403,"admin_inactive","Administrationszugang wurde deaktiviert.");
  if(status==="employee_inactive")fail(403,"employee_inactive","Mitarbeiterzugang wurde deaktiviert.");
  if(status!=="ok")fail(403,"inventory_forbidden","Bestand ist für diesen Zugang nicht freigeschaltet.");
  const accessRole=String(resolved.accessRole||"") as InventoryContext["accessRole"];
  if(!["owner","manager","employee"].includes(accessRole))fail(403,"inventory_forbidden","Bestand ist für diesen Zugang nicht freigeschaltet.");
  const locationIds=[...new Set((Array.isArray(resolved.locationIds)?resolved.locationIds:[]).filter(Boolean).map(String))];
  const permissions:PermissionRow[]=(Array.isArray(resolved.permissions)?resolved.permissions:[]).map((row:any)=>({locationId:String(row?.locationId||""),permission:String(row?.permission||"")})).filter((row:PermissionRow)=>row.locationId&&row.permission);
  const features:FeatureRow[]=(Array.isArray(resolved.features)?resolved.features:[]).map((row:any)=>({key:String(row?.key||""),locationId:row?.locationId==null?null:String(row.locationId),enabled:Boolean(row?.enabled)})).filter((row:FeatureRow)=>row.key);
  return{organizationId:String(resolved.organizationId),organizationName:String(resolved.organizationName||"Aora"),subjectId:String(resolved.subjectId),accessRole,locationIds,permissions,features,token};
}

export function requireLocation(ctx:InventoryContext,locationId:string){if(!locationId||!ctx.locationIds.includes(locationId))fail(403,"location_forbidden","Für diesen Standort fehlt die Berechtigung.")}
export async function hasPermission(ctx:InventoryContext,locationId:string,permission:string,_requestId:string){
  if(ctx.accessRole==="owner")return true;
  return ctx.permissions.some(row=>row.locationId===locationId&&row.permission===permission);
}
export async function requirePermission(ctx:InventoryContext,locationId:string,permission:string,requestId:string){requireLocation(ctx,locationId);if(!await hasPermission(ctx,locationId,permission,requestId))fail(403,"inventory_permission_forbidden","Für diese Bestandsfunktion fehlt die Berechtigung.")}
export async function featureEnabled(ctx:InventoryContext,key:string,locationId:string|null,_requestId:string){
  const local=ctx.features.find(row=>row.key===key&&row.locationId===locationId);const global=ctx.features.find(row=>row.key===key&&row.locationId==null);return Boolean((local||global)?.enabled);
}
export async function requireFeature(ctx:InventoryContext,key:string,locationId:string,requestId:string){if(!await featureEnabled(ctx,key,locationId,requestId))fail(404,"feature_disabled","Diese Funktion ist für diesen Betrieb noch nicht freigeschaltet.")}
