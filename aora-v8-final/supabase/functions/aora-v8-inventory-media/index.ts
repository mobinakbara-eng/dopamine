import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {ApiError,MAX_BODY_BYTES,allowedOrigin,cors,json,fail,sessionContext,requireFeature} from "../aora-v8-inventory-next/lib.ts";
import {prepareInventoryImageUpload,confirmInventoryImageUpload,listInventoryMedia} from "../aora-v8-inventory-next/inventory-media.ts";

Deno.serve(async request=>{
  const origin=request.headers.get("origin"),requestId=request.headers.get("x-request-id")||crypto.randomUUID();
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST")return json({error:"Method not allowed",code:"method_not_allowed"},405,origin,requestId);
  if(origin&&!allowedOrigin(origin))return json({error:"Origin not allowed",code:"origin_forbidden"},403,origin,requestId);
  try{
    const raw=await request.text();
    if(new TextEncoder().encode(raw).byteLength>MAX_BODY_BYTES)fail(413,"request_too_large","Die Anfrage ist zu groß.");
    let body:any;try{body=JSON.parse(raw)}catch{fail(400,"invalid_json","Ungültige Anfrage.")}
    const action=String(body.action||"");
    if(action==="health")return json({ok:true,service:"aora-v8-inventory-media",version:1},200,origin,requestId);
    const ctx=await sessionContext(String(body.sessionToken||body.token||""),requestId);
    const locationId=String(body.locationId||"");
    if(!locationId)fail(400,"location_required","Standort fehlt.");
    await requireFeature(ctx,"inventory_v1",locationId,requestId);
    let data:any;
    if(action==="prepareInventoryImageUpload")data=await prepareInventoryImageUpload(ctx,body,requestId);
    else if(action==="confirmInventoryImageUpload")data=await confirmInventoryImageUpload(ctx,body,requestId);
    else if(action==="listInventoryMedia")data=await listInventoryMedia(ctx,body,requestId);
    else fail(400,"unknown_action","Unbekannte Aktion.");
    return json(data,200,origin,requestId);
  }catch(error){
    const e=error instanceof ApiError?error:new ApiError(500,"internal_error","Die Aktion konnte nicht abgeschlossen werden.");
    console.warn("aora-inventory-media-rejected",{requestId,status:e.status,code:e.code,message:e.message});
    return json({error:e.message,code:e.code,requestId},e.status,origin,requestId);
  }
});
