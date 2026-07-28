import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service=createClient(URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_ORIGIN="https://aora-v8-hardening.vercel.app";
const TEAM_SUFFIX="-mobins-projects-4f428afa.vercel.app";
const EXACT=new Set([DEFAULT_ORIGIN,"https://aora-v8-final.vercel.app","https://aora-workforce.vercel.app"]);
const ALLOWED_KEYS=new Set(["locations","admins","employees","shifts","timeEntries","leaveRequests","correctionRequests","announcements","notifications","kioskDevices","audit","clockRequests","invitations","compliance"]);
const recent=new Map<string,number>();

function allowed(origin:string|null){if(!origin)return true;if(EXACT.has(origin))return true;try{const url=new URL(origin);return ["localhost","127.0.0.1"].includes(url.hostname)||(url.protocol==="https:"&&url.hostname.endsWith(TEAM_SUFFIX))}catch{return false}}
function headers(origin:string|null){return{"Access-Control-Allow-Origin":origin&&allowed(origin)?origin:DEFAULT_ORIGIN,"Access-Control-Allow-Headers":"content-type,authorization,apikey","Access-Control-Allow-Methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",Vary:"Origin"}}
function json(body:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(body),{status,headers:headers(origin)})}
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function cleanEvent(value:unknown){const event=String(value||"WORKSPACE_CHANGED").toUpperCase();return/^[A-Z][A-Z0-9_]{0,63}$/.test(event)?event:"WORKSPACE_CHANGED"}
function cleanKeys(value:unknown){return[...new Set((Array.isArray(value)?value:[]).map(String).filter(key=>ALLOWED_KEYS.has(key)))].slice(0,20)}
async function context(token:string){if(token.length!==64)fail("Sitzungstoken fehlt.",401);const {data,error}=await service.rpc("validate_demo_session",{p_token:token});if(error||!data?.length)fail("Sitzung ist ungültig oder abgelaufen.",401);return data[0]}
async function send(messages:any[]){for(let index=0;index<messages.length;index+=100){const batch=messages.slice(index,index+100);const response=await fetch(`${URL}/realtime/v1/api/broadcast`,{method:"POST",headers:{"content-type":"application/json",apikey:SERVICE_KEY,authorization:`Bearer ${SERVICE_KEY}`},body:JSON.stringify({messages:batch})});if(!response.ok){const text=await response.text();throw new Error(`Realtime Broadcast HTTP ${response.status}: ${text.slice(0,160)}`)}}}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
  if(req.method!=="POST")return json({error:"Method not allowed"},405,origin);
  if(origin&&!allowed(origin))return json({error:"Origin not allowed"},403,origin);
  try{
    const body=await req.json();
    const token=String(body.token||"");
    const session=await context(token);
    const last=recent.get(token)||0;
    if(Date.now()-last<200)return json({ok:true,coalesced:true},202,origin);
    recent.set(token,Date.now());
    const {data:rows,error}=await service.rpc("aora_active_session_topics",{p_organization_id:session.organization_id});
    if(error)throw error;
    const revision=Math.max(0,Math.trunc(Number(body.revision)||0));
    const eventType=cleanEvent(body.eventType);
    const keys=cleanKeys(body.keys);
    const payload={revision,eventType,keys,reconcile:keys.length===0,changedAt:new Date().toISOString()};
    const messages=(rows||[]).map((row:any)=>({topic:String(row.topic),event:"workspace-change",payload}));
    if(messages.length)await send(messages);
    return json({ok:true,deliveredTopics:messages.length},200,origin);
  }catch(error:any){return json({error:error instanceof Error?error.message:String(error)},Number(error?.status||500),origin)}
});
