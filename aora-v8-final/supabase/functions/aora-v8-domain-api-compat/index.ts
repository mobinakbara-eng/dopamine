import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const UPSTREAM=`${SUPABASE_URL}/functions/v1/aora-v8-domain-api`;
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_ORIGIN="https://dopamine-mobins-projects-4f428afa.vercel.app";
const TEAM_PREVIEW_SUFFIX="-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS=new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://aora-workforce.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-v8-hardening.vercel.app"
]);
const MAX_BODY_BYTES=2_500_000;

function allowedOrigin(origin:string|null){
  if(!origin)return true;
  if(EXACT_ORIGINS.has(origin))return true;
  try{
    const parsed=new URL(origin);
    return ["localhost","127.0.0.1"].includes(parsed.hostname)||(parsed.protocol==="https:"&&parsed.hostname.endsWith(TEAM_PREVIEW_SUFFIX));
  }catch{return false}
}
function cors(origin:string|null){
  return{
    "Access-Control-Allow-Origin":origin&&allowedOrigin(origin)?origin:DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-request-id",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Access-Control-Max-Age":"600",
    Vary:"Origin"
  };
}
function json(body:unknown,status:number,origin:string|null){
  return new Response(JSON.stringify(body),{status,headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});
}

async function enrichTaskItems(envelope:any,token:string){
  const tasks=Array.isArray(envelope?.data)?envelope.data:[];
  if(!tasks.length)return envelope;
  const{data:sessions,error:sessionError}=await service.rpc("validate_demo_session",{p_token:token});
  const organizationId=sessions?.[0]?.organization_id;
  if(sessionError||!organizationId)throw new Error("Task session could not be validated.");
  const templateIds=[...new Set(tasks.map((task:any)=>String(task.template_id||"")).filter(Boolean))];
  if(!templateIds.length)return envelope;
  const{data:items,error}=await service.from("task_template_items").select("*").eq("organization_id",organizationId).in("template_id",templateIds).order("position",{ascending:true});
  if(error)throw error;
  const grouped=new Map<string,any[]>();
  for(const item of items||[]){
    const key=String(item.template_id);
    const list=grouped.get(key)||[];
    list.push(item);
    grouped.set(key,list);
  }
  envelope.data=tasks.map((task:any)=>({
    ...task,
    task_templates:{...(task.task_templates||{}),task_template_items:grouped.get(String(task.template_id))||[]}
  }));
  return envelope;
}

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST")return json({error:{code:"method_not_allowed",message:"Method not allowed"}},405,origin);
  if(origin&&!allowedOrigin(origin))return json({error:{code:"origin_forbidden",message:"Origin not allowed"}},403,origin);
  const length=Number(request.headers.get("content-length")||0);
  if(length>MAX_BODY_BYTES)return json({error:{code:"request_too_large",message:"Request too large"}},413,origin);
  try{
    const text=await request.text();
    if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)return json({error:{code:"request_too_large",message:"Request too large"}},413,origin);
    const body=text?JSON.parse(text):{};
    const upstream=await fetch(UPSTREAM,{
      method:"POST",
      headers:{"content-type":"application/json","authorization":`Bearer ${SERVICE_KEY}`,"apikey":SERVICE_KEY,"x-request-id":request.headers.get("x-request-id")||crypto.randomUUID()},
      body:JSON.stringify(body)
    });
    const upstreamText=await upstream.text();
    let envelope:any;
    try{envelope=upstreamText?JSON.parse(upstreamText):{}}catch{envelope={error:{code:"invalid_upstream_response",message:upstreamText||"Invalid upstream response"}}}
    if(upstream.ok&&String(body.action||"")==="tasks")envelope=await enrichTaskItems(envelope,String(body.token||""));
    return json(envelope,upstream.status,origin);
  }catch(error){
    return json({error:{code:"compat_error",message:error instanceof Error?error.message:String(error)}},500,origin);
  }
});
