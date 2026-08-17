import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const BATCH=100;
const MAX_ATTEMPTS=8;
const CLAIM_TIMEOUT_SECONDS=300;
const now=()=>new Date().toISOString();
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});

async function secret(name:string){
  const{data,error}=await db.rpc("aora_get_runtime_secret",{p_name:name});
  if(error)throw new Error(`runtime_secret:${name}`);
  return String(data||"");
}

function destination(notification:any){
  const type=String(notification.related_entity_type||notification.payload?.relatedEntityType||"");
  const target=String(notification.related_entity_id||notification.payload?.relatedEntityId||"");
  if(type==="task"&&target)return`/arbeitnehmer/?task=${encodeURIComponent(target)}`;
  if(type==="shift"&&target)return`/arbeitnehmer/?shift=${encodeURIComponent(target)}`;
  if(type==="calendar")return`/arbeitnehmer/?date=${encodeURIComponent(target)}`;
  return"/arbeitnehmer/";
}

function backoff(attempts:number){
  return Math.min(24*60,Math.max(1,2**Math.min(attempts,10)))*60*1000;
}

async function completeTarget(target:any,workerId:string,state:"sent"|"failed"|"expired",errorText:string|null){
  const attempts=Number(target.attempts||0);
  const terminal=state==="failed"&&attempts>=MAX_ATTEMPTS;
  const update:any={
    status:state,
    last_error:errorText,
    claim_token:null,
    claimed_at:null,
    updated_at:now(),
    next_attempt_at:state==="failed"&&!terminal?new Date(Date.now()+backoff(attempts)).toISOString():null
  };
  if(state==="sent")update.sent_at=now();
  const{error}=await db.from("notification_push_delivery_targets")
    .update(update)
    .eq("id",target.target_id)
    .eq("claim_token",workerId)
    .eq("status","sending");
  if(error)throw new Error("push_target_update_failed");
}

Deno.serve(async request=>{
  if(request.method!=="POST")return reply({error:"method_not_allowed"},405);
  try{
    const expected=await secret("aora_push_dispatch_token");
    if(!expected||request.headers.get("x-aora-job-token")!==expected)return reply({error:"forbidden"},403);

    const[publicKey,privateKey]=await Promise.all([secret("aora_vapid_public_key"),secret("aora_vapid_private_key")]);
    if(!publicKey||!privateKey)throw new Error("vapid_missing");
    webpush.setVapidDetails("https://dopamine-blond.vercel.app",publicKey,privateKey);

    const{data:prepared,error:prepareError}=await db.rpc("aora_push_prepare_deliveries",{p_limit:BATCH});
    if(prepareError)throw new Error("push_prepare_failed");

    const workerId=crypto.randomUUID();
    const{data:targets,error:claimError}=await db.rpc("aora_push_claim_targets",{
      p_worker_id:workerId,
      p_limit:BATCH,
      p_lock_timeout_seconds:CLAIM_TIMEOUT_SECONDS
    });
    if(claimError)throw new Error("push_claim_failed");
    if(!targets?.length)return reply({ok:true,prepared:(prepared||[]).length,processed:0,sent:0,failed:0,expired:0,server_time:now()});

    const deliveryIds=[...new Set(targets.map((t:any)=>String(t.delivery_id)))];
    const subscriptionIds=[...new Set(targets.map((t:any)=>String(t.subscription_id)))];
    const[{data:deliveries,error:deliveryError},{data:subscriptions,error:subscriptionError}]=await Promise.all([
      db.from("notification_deliveries").select("id,organization_id,notification_id").in("id",deliveryIds),
      db.from("push_subscriptions").select("id,organization_id,employee_id,endpoint,p256dh,auth_secret,active").in("id",subscriptionIds)
    ]);
    if(deliveryError||subscriptionError)throw new Error("push_context_failed");

    const notificationIds=[...new Set((deliveries||[]).map((d:any)=>String(d.notification_id)))];
    const{data:notifications,error:notificationError}=notificationIds.length
      ?await db.from("notifications").select("id,organization_id,employee_id,location_id,type,title,body,related_entity_type,related_entity_id,payload,deleted_at").in("id",notificationIds).is("deleted_at",null)
      :{data:[],error:null};
    if(notificationError)throw new Error("push_notifications_failed");

    const deliveryMap=new Map((deliveries||[]).map((d:any)=>[String(d.id),d]));
    const subscriptionMap=new Map((subscriptions||[]).map((s:any)=>[String(s.id),s]));
    const notificationMap=new Map((notifications||[]).map((n:any)=>[`${n.organization_id}:${n.id}`,n]));

    let sent=0,failed=0,expired=0;
    for(const target of targets){
      const delivery=deliveryMap.get(String(target.delivery_id));
      const subscription=subscriptionMap.get(String(target.subscription_id));
      const notification=delivery?notificationMap.get(`${delivery.organization_id}:${delivery.notification_id}`):null;

      if(!delivery||!notification?.employee_id||!subscription||subscription.active!==true){
        await completeTarget(target,workerId,"expired","subscription_or_notification_unavailable");
        expired++;
        continue;
      }

      const payload=JSON.stringify({
        title:notification.title||"Aora",
        body:notification.body||"Neue Mitteilung",
        url:destination(notification),
        tag:`aora-${notification.id}`,
        notificationId:notification.id,
        relatedEntityType:notification.related_entity_type,
        relatedEntityId:notification.related_entity_id
      });

      try{
        await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth_secret}},payload,{TTL:3600,urgency:"normal",topic:String(notification.id).slice(0,32)});
        await completeTarget(target,workerId,"sent",null);
        await db.from("push_subscriptions").update({last_used_at:now()}).eq("id",subscription.id);
        sent++;
      }catch(error:any){
        const status=Number(error?.statusCode||error?.status||0);
        if(status===404||status===410){
          await db.from("push_subscriptions").update({active:false,revoked_at:now()}).eq("id",subscription.id);
          await completeTarget(target,workerId,"expired",`expired:${status}`);
          expired++;
        }else{
          await completeTarget(target,workerId,"failed",`delivery:${status||"unknown"}`);
          failed++;
        }
      }
    }

    for(const deliveryId of deliveryIds){
      const{error}=await db.rpc("aora_push_reconcile_delivery",{p_delivery_id:deliveryId});
      if(error)console.error("aora-push-reconcile",{deliveryId,error:error.message});
    }

    return reply({ok:failed===0,prepared:(prepared||[]).length,processed:targets.length,sent,failed,expired,server_time:now()},failed&&sent===0?500:200);
  }catch(error){
    console.error("aora-push-dispatch",error instanceof Error?error.message:String(error));
    return reply({error:"push_dispatch_failed"},500);
  }
});
