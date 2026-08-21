import {db,dbFail,fail,now,asUuid,idem,email,phoneDigits,requireLocation,requirePermission,type InventoryContext} from "./lib.ts";

export async function createPurchaseOrder(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const supplierId=asUuid(body.supplierId,"supplier"),requested=Array.isArray(body.lines)?body.lines:[];
  if(!requested.length)fail(400,"po_lines_required","Bitte mindestens einen Artikel auswählen.");
  const ids=requested.map((x:any)=>asUuid(x.supplierItemId,"supplier_item"));
  const{data:maps,error}=await db.from("inventory_supplier_items").select("id,item_id,pack_unit_id,supplier_sku,supplier_item_name,unit_price,minimum_order_quantity,order_multiple").eq("organization_id",ctx.organizationId).eq("supplier_id",supplierId).in("id",ids).eq("active",true);
  if(error)dbFail(error,"po_supplier_items",requestId);
  if((maps||[]).length!==new Set(ids).size)fail(400,"po_supplier_item_invalid","Mindestens ein Artikel gehört nicht zu diesem Lieferanten.");
  const packIds=[...new Set((maps||[]).map((m:any)=>m.pack_unit_id).filter(Boolean))];
  const{data:packs,error:pe}=packIds.length?await db.from("inventory_pack_units").select("id,base_quantity").eq("organization_id",ctx.organizationId).in("id",packIds):{data:[],error:null};
  if(pe)dbFail(pe,"po_packs",requestId);
  const mm=new Map((maps||[]).map((m:any)=>[String(m.id),m])),pm=new Map((packs||[]).map((p:any)=>[String(p.id),Number(p.base_quantity)]));
  const lines=requested.map((r:any)=>{
    const m:any=mm.get(String(r.supplierItemId));
    const packCount=Number(r.packCount),minimum=Number(m?.minimum_order_quantity||1),multiple=Number(m?.order_multiple||1);
    if(!Number.isFinite(packCount)||packCount<minimum||Math.abs(packCount/multiple-Math.round(packCount/multiple))>1e-8)fail(400,"po_quantity_invalid",`Bestellmenge für ${m?.supplier_item_name||"Artikel"} entspricht nicht der Bestelleinheit.`);
    const base=Number(m?.pack_unit_id?pm.get(String(m.pack_unit_id))||1:1);
    return{item_id:m.item_id,ordered_quantity:packCount*base,unit_cost:m.unit_price==null?null:Number(m.unit_price)/base,supplier_item_id:m.id,pack_unit_id:m.pack_unit_id,ordered_pack_quantity:packCount,supplier_sku:m.supplier_sku||"",supplier_item_name:m.supplier_item_name||""};
  });
  const{data,error:re}=await db.rpc("aora_inventory_create_purchase_order",{p_organization_id:ctx.organizationId,p_location_id:locationId,p_supplier_id:supplierId,p_lines:lines,p_expected_on:body.expectedOn||null,p_note:String(body.note||""),p_actor_id:ctx.subjectId,p_idempotency_key:idem(body.idempotencyKey)});
  if(re)dbFail(re,"create_po",requestId);
  return data;
}

async function orderMessage(ctx:InventoryContext,orderId:string,requestId:string){
  const{data:o,error}=await db.from("inventory_purchase_orders").select("*").eq("organization_id",ctx.organizationId).eq("id",orderId).maybeSingle();
  if(error)dbFail(error,"order",requestId);
  if(!o)fail(404,"po_not_found","Bestellung wurde nicht gefunden.");
  requireLocation(ctx,String(o.location_id));
  const[{data:s,error:se},{data:lines,error:le},{data:profile,error:pr},{data:loc,error:loe}]=await Promise.all([
    db.from("inventory_suppliers").select("id,name,contact").eq("organization_id",ctx.organizationId).eq("id",o.supplier_id).single(),
    db.from("inventory_purchase_order_lines").select("item_id,ordered_quantity,unit_cost,pack_unit_id,ordered_pack_quantity,supplier_sku,supplier_item_name").eq("organization_id",ctx.organizationId).eq("purchase_order_id",o.id),
    db.from("inventory_ordering_profiles").select("*").eq("organization_id",ctx.organizationId).eq("location_id",o.location_id).maybeSingle(),
    db.from("locations").select("name,address,city,payload").eq("organization_id",ctx.organizationId).eq("id",o.location_id).single()
  ]);
  if(se||le||pr||loe)dbFail(se||le||pr||loe,"order_context",requestId);
  const itemIds=(lines||[]).map((l:any)=>l.item_id),packIds=(lines||[]).map((l:any)=>l.pack_unit_id).filter(Boolean);
  const[{data:items,error:ie},{data:packs,error:pe}]=await Promise.all([
    itemIds.length?db.from("inventory_items").select("id,name,base_uom").eq("organization_id",ctx.organizationId).in("id",itemIds):Promise.resolve({data:[],error:null}),
    packIds.length?db.from("inventory_pack_units").select("id,label,code,base_quantity").eq("organization_id",ctx.organizationId).in("id",packIds):Promise.resolve({data:[],error:null})
  ]);
  if(ie||pe)dbFail(ie||pe,"order_message_items",requestId);
  const im=new Map((items||[]).map((i:any)=>[String(i.id),i])),pm=new Map((packs||[]).map((p:any)=>[String(p.id),p]));
  const p=profile||{cafe_name:loc?.name||"",legal_name:ctx.organizationName,address:loc?.address||"",postal_code:String(loc?.payload?.postalCode||""),city:loc?.city||"",phone:String(loc?.payload?.phone||""),ordering_email:"",reply_to_email:"",whatsapp_number:"",customer_number:"",vat_id:"",signature:""};
  const lineText=(lines||[]).map((l:any)=>{
    const pack:any=pm.get(String(l.pack_unit_id)),item:any=im.get(String(l.item_id));
    const qty=l.ordered_pack_quantity==null?Number(l.ordered_quantity):Number(l.ordered_pack_quantity);
    return`${qty} × ${l.supplier_item_name||item?.name||"Artikel"}${pack?.label?` – ${pack.label}`:""}${l.supplier_sku?` (SKU ${l.supplier_sku})`:""}`;
  }).join("\n");
  const text=`Guten Tag,\n\nwir möchten folgende Bestellung für unseren Standort ${p.cafe_name||loc?.name||""} aufgeben:\n\n${lineText}\n\n${o.expected_on?`Gewünschte Lieferung: ${o.expected_on}\n\n`:""}Lieferadresse:\n${p.address||loc?.address||""}\n${p.postal_code||""} ${p.city||loc?.city||""}\n\nBestellnummer: ${o.order_number||o.id}\n${p.customer_number?`Kundennummer: ${p.customer_number}\n`:""}Kontakt: ${p.ordering_email||""}${p.phone?` · ${p.phone}`:""}\n\n${p.signature||`Freundliche Grüße\n${p.cafe_name||loc?.name||""}`}`;
  return{order:o,supplier:s,profile:p,text,subject:`Bestellung ${o.order_number||""} – ${p.cafe_name||loc?.name||"Aora"}`};
}

async function loadDelivery(ctx:InventoryContext,key:string){
  const{data,error}=await db.from("inventory_purchase_order_deliveries")
    .select("id,status,manual_link,provider_message_id,provider_status,attempts,channel")
    .eq("organization_id",ctx.organizationId)
    .eq("idempotency_key",key)
    .maybeSingle();
  if(error)throw error;
  return data;
}

async function reconcileSentOrder(ctx:InventoryContext,context:any,existing:any,channel:string,requestId:string){
  if(["placed","submitted","delivered","partially_received","received"].includes(String(context.order.status)))return;
  const{error}=await db.from("inventory_purchase_orders").update({
    status:"placed",
    delivery_channel:channel,
    sent_at:context.order.sent_at||now(),
    submitted_at:context.order.submitted_at||now(),
    provider_message_id:existing?.provider_message_id||context.order.provider_message_id||null,
    provider_status:existing?.provider_status||context.order.provider_status||"accepted",
    last_error:null,
    updated_by:ctx.subjectId,
    updated_at:now(),
    version:Number(context.order.version||1)+1
  }).eq("organization_id",ctx.organizationId).eq("id",context.order.id);
  if(error)dbFail(error,"reconcile_sent_order",requestId);
}

export async function sendPurchaseOrder(ctx:InventoryContext,body:any,requestId:string){
  const orderId=asUuid(body.purchaseOrderId,"purchase_order"),channel=String(body.channel||"").toLowerCase();
  if(!["email","whatsapp"].includes(channel))return fail(400,"channel_invalid","Bitte E-Mail oder WhatsApp auswählen.");
  const context=await orderMessage(ctx,orderId,requestId);
  await requirePermission(ctx,String(context.order.location_id),"procurement",requestId);

  // One deterministic operation per PO/channel. The provider receives the same key
  // on every retry, so a crash after provider acceptance cannot create a second order.
  const key=`send:${orderId}:${channel}`;
  let existing:any;
  try{existing=await loadDelivery(ctx,key)}catch(e){dbFail(e,"delivery_lookup",requestId)}

  if(existing&&["sent","delivered","read","confirmed_manual"].includes(String(existing.status))){
    await reconcileSentOrder(ctx,context,existing,channel,requestId);
    return{status:"placed",channel,providerMessageId:existing.provider_message_id||null,deliveryId:existing.id,idempotent:true};
  }
  if(existing?.status==="manual_required")return{status:"manual_required",channel,manualLink:existing.manual_link,deliveryId:existing.id,idempotent:true};
  if(["placed","submitted","delivered","partially_received","received"].includes(String(context.order.status)))return{status:"placed",channel,providerMessageId:context.order.provider_message_id||null,idempotent:true};
  if(!["draft","ready","send_failed","sending"].includes(String(context.order.status)))fail(409,"po_state_invalid","Diese Bestellung kann in diesem Status nicht gesendet werden.");

  const supplierContact=context.supplier?.contact||{},snapshot={name:context.supplier?.name||"",...supplierContact},locationSnapshot=context.profile;

  if(channel==="email"){
    const to=email(supplierContact.email);
    if(!to)fail(400,"supplier_email_missing","Für diesen Lieferanten ist keine E-Mail-Adresse hinterlegt.");
    const apiKey=Deno.env.get("RESEND_API_KEY")||Deno.env.get("AORA_ORDER_EMAIL_API_KEY")||"",fromEmail=email(Deno.env.get("AORA_ORDER_FROM_EMAIL")||""),reply=email(context.profile.reply_to_email||context.profile.ordering_email);

    if(!apiKey||!fromEmail){
      const link=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(context.subject)}&body=${encodeURIComponent(context.text)}`;
      let deliveryId=existing?.id;
      if(existing){
        const{error}=await db.from("inventory_purchase_order_deliveries").update({channel:"manual_email",status:"manual_required",recipient:to,sender_identity:context.profile.cafe_name||"",reply_to:reply,provider:"mailto",manual_link:link,last_error:null}).eq("organization_id",ctx.organizationId).eq("id",existing.id);
        if(error)dbFail(error,"manual_email_delivery",requestId);
      }else{
        const{data:d,error}=await db.from("inventory_purchase_order_deliveries").insert({organization_id:ctx.organizationId,purchase_order_id:orderId,channel:"manual_email",status:"manual_required",recipient:to,sender_identity:context.profile.cafe_name||"",reply_to:reply,provider:"mailto",manual_link:link,idempotency_key:key,created_by:ctx.subjectId}).select("id").single();
        if(error){
          if(String(error.code)==="23505"){
            try{existing=await loadDelivery(ctx,key)}catch(e){dbFail(e,"manual_email_delivery_lookup",requestId)}
            deliveryId=existing?.id;
          }else dbFail(error,"manual_email_delivery",requestId);
        }else deliveryId=d.id;
      }
      const{error:oe}=await db.from("inventory_purchase_orders").update({status:"ready",delivery_channel:"email",supplier_contact_snapshot:snapshot,location_contact_snapshot:locationSnapshot,updated_by:ctx.subjectId,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",orderId);
      if(oe)dbFail(oe,"manual_email_order",requestId);
      return{status:"manual_required",channel:"email",manualLink:link,deliveryId};
    }

    // Durable claim is written before the external side effect.
    if(existing){
      const{error}=await db.from("inventory_purchase_order_deliveries").update({channel:"email",status:"sending",recipient:to,sender_identity:fromEmail,reply_to:reply,provider:"resend",manual_link:null,last_error:null,attempts:Number(existing.attempts||0)+1}).eq("organization_id",ctx.organizationId).eq("id",existing.id);
      if(error)dbFail(error,"email_delivery_claim",requestId);
    }else{
      const{data:d,error}=await db.from("inventory_purchase_order_deliveries").insert({organization_id:ctx.organizationId,purchase_order_id:orderId,channel:"email",status:"sending",recipient:to,sender_identity:fromEmail,reply_to:reply,provider:"resend",attempts:1,idempotency_key:key,created_by:ctx.subjectId}).select("id,status,attempts").single();
      if(error){
        if(String(error.code)==="23505"){
          try{existing=await loadDelivery(ctx,key)}catch(e){dbFail(e,"email_delivery_claim_lookup",requestId)}
        }else dbFail(error,"email_delivery_claim",requestId);
      }else existing=d;
    }

    const{error:claimOrderError}=await db.from("inventory_purchase_orders").update({status:"sending",delivery_channel:"email",supplier_contact_snapshot:snapshot,location_contact_snapshot:locationSnapshot,last_error:null,updated_by:ctx.subjectId,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",orderId);
    if(claimOrderError)dbFail(claimOrderError,"email_order_claim",requestId);

    const r=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":key},
      body:JSON.stringify({from:`${context.profile.cafe_name||"Aora"} <${fromEmail}>`,to:[to],subject:context.subject,text:context.text,reply_to:reply||undefined})
    });
    const payload=await r.json().catch(()=>({}));
    if(!r.ok){
      const message=`HTTP ${r.status}`;
      const{error:de}=await db.from("inventory_purchase_order_deliveries").update({status:"failed",last_error:message}).eq("organization_id",ctx.organizationId).eq("idempotency_key",key);
      if(de)dbFail(de,"email_delivery_fail_log",requestId);
      const{error:oe}=await db.from("inventory_purchase_orders").update({status:"send_failed",last_error:"E-Mail konnte nicht gesendet werden.",updated_by:ctx.subjectId,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",orderId);
      if(oe)dbFail(oe,"email_order_fail_log",requestId);
      fail(502,"supplier_email_failed","Die Bestellung konnte nicht per E-Mail gesendet werden.");
    }

    const messageId=String(payload?.id||"");
    const{data:d,error:de}=await db.from("inventory_purchase_order_deliveries").update({status:"sent",provider_message_id:messageId,provider_status:"accepted",last_error:null,sent_at:now()}).eq("organization_id",ctx.organizationId).eq("idempotency_key",key).select("id").single();
    if(de)dbFail(de,"email_delivery_log",requestId);
    const{error:oe}=await db.from("inventory_purchase_orders").update({status:"placed",delivery_channel:"email",sent_at:now(),submitted_at:now(),supplier_contact_snapshot:snapshot,location_contact_snapshot:locationSnapshot,provider_message_id:messageId,provider_status:"accepted",last_error:null,updated_by:ctx.subjectId,updated_at:now(),version:Number(context.order.version||1)+1}).eq("organization_id",ctx.organizationId).eq("id",orderId);
    if(oe)dbFail(oe,"email_order_commit",requestId);
    return{status:"placed",channel:"email",providerMessageId:messageId,deliveryId:d.id,idempotent:false};
  }

  const digits=phoneDigits(supplierContact.whatsapp);
  if(digits.length<8)fail(400,"supplier_whatsapp_missing","Für diesen Lieferanten ist keine WhatsApp-Nummer hinterlegt.");
  const link=`https://wa.me/${digits}?text=${encodeURIComponent(context.text)}`;
  let deliveryId=existing?.id;
  if(existing){
    const{error}=await db.from("inventory_purchase_order_deliveries").update({channel:"manual_whatsapp",status:"manual_required",recipient:digits,sender_identity:context.profile.whatsapp_number||context.profile.phone||"",provider:"whatsapp_deeplink",manual_link:link,last_error:null}).eq("organization_id",ctx.organizationId).eq("id",existing.id);
    if(error)dbFail(error,"manual_whatsapp_delivery",requestId);
  }else{
    const{data:d,error}=await db.from("inventory_purchase_order_deliveries").insert({organization_id:ctx.organizationId,purchase_order_id:orderId,channel:"manual_whatsapp",status:"manual_required",recipient:digits,sender_identity:context.profile.whatsapp_number||context.profile.phone||"",provider:"whatsapp_deeplink",manual_link:link,idempotency_key:key,created_by:ctx.subjectId}).select("id").single();
    if(error){
      if(String(error.code)==="23505"){
        try{existing=await loadDelivery(ctx,key)}catch(e){dbFail(e,"manual_whatsapp_delivery_lookup",requestId)}
        deliveryId=existing?.id;
      }else dbFail(error,"manual_whatsapp_delivery",requestId);
    }else deliveryId=d.id;
  }
  const{error:oe}=await db.from("inventory_purchase_orders").update({status:"ready",delivery_channel:"whatsapp",supplier_contact_snapshot:snapshot,location_contact_snapshot:locationSnapshot,updated_by:ctx.subjectId,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",orderId);
  if(oe)dbFail(oe,"manual_whatsapp_order",requestId);
  return{status:"manual_required",channel:"whatsapp",manualLink:link,deliveryId};
}

export async function confirmManualPurchaseOrderSent(ctx:InventoryContext,body:any,requestId:string){
  const orderId=asUuid(body.purchaseOrderId,"purchase_order"),deliveryId=asUuid(body.deliveryId,"delivery");
  const{data:o,error}=await db.from("inventory_purchase_orders").select("location_id,status,version").eq("organization_id",ctx.organizationId).eq("id",orderId).single();
  if(error)dbFail(error,"manual_order",requestId);
  await requirePermission(ctx,String(o.location_id),"procurement",requestId);
  const{data:d,error:de}=await db.from("inventory_purchase_order_deliveries").select("channel,status").eq("organization_id",ctx.organizationId).eq("id",deliveryId).eq("purchase_order_id",orderId).single();
  if(de)dbFail(de,"manual_delivery",requestId);
  if(d.status==="confirmed_manual")return{status:"placed",idempotent:true};
  if(d.status!=="manual_required")fail(409,"delivery_state_invalid","Versandstatus wurde bereits geändert.");
  const{error:du}=await db.from("inventory_purchase_order_deliveries").update({status:"confirmed_manual",sent_at:now(),provider_status:"manager_confirmed"}).eq("organization_id",ctx.organizationId).eq("id",deliveryId);
  if(du)dbFail(du,"manual_delivery_confirm",requestId);
  const{error:ou}=await db.from("inventory_purchase_orders").update({status:"placed",sent_at:now(),submitted_at:now(),provider_status:"manager_confirmed",version:Number(o.version||1)+1,updated_by:ctx.subjectId,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",orderId);
  if(ou)dbFail(ou,"manual_order_confirm",requestId);
  return{status:"placed",idempotent:false};
}

export async function listPurchaseOrderDeliveries(ctx:InventoryContext,body:any,requestId:string){
  const orderId=asUuid(body.purchaseOrderId,"purchase_order");
  const{data:o,error}=await db.from("inventory_purchase_orders").select("location_id").eq("organization_id",ctx.organizationId).eq("id",orderId).single();
  if(error)dbFail(error,"delivery_order",requestId);
  await requirePermission(ctx,String(o.location_id),"procurement",requestId);
  const{data,error:de}=await db.from("inventory_purchase_order_deliveries").select("id,channel,status,recipient,provider,provider_message_id,provider_status,manual_link,created_at,sent_at").eq("organization_id",ctx.organizationId).eq("purchase_order_id",orderId).order("created_at",{ascending:false});
  if(de)dbFail(de,"deliveries",requestId);
  return{deliveries:data||[]};
}
