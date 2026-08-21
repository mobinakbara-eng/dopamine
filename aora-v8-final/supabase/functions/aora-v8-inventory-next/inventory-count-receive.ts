import {db,dbFail,fail,asUuid,idem,requirePermission,requireFeature,type InventoryContext} from "./lib.ts";

async function enrichConsumption(ctx:InventoryContext,data:any,locationId:string,requestId:string){
  const itemId=String(data?.itemId||data?.item_id||""),packUnitId=String(data?.packUnitId||data?.pack_unit_id||""),stockUnitId=String(data?.stockUnitId||data?.stock_unit_id||"");
  const[{data:item,error:ie},{data:pack,error:pe},{data:balance,error:be},{data:stockUnit,error:sue}]=await Promise.all([
    itemId?db.from("inventory_items").select("id,name,sku,base_uom,consumption_mode,default_consume_quantity,expiry_tracking,default_shelf_life_days,expiry_alert_days").eq("organization_id",ctx.organizationId).eq("id",itemId).maybeSingle():Promise.resolve({data:null,error:null}),
    packUnitId?db.from("inventory_pack_units").select("id,label,code,base_quantity").eq("organization_id",ctx.organizationId).eq("id",packUnitId).maybeSingle():Promise.resolve({data:null,error:null}),
    itemId&&locationId?db.from("inventory_balances").select("on_hand").eq("organization_id",ctx.organizationId).eq("location_id",locationId).eq("item_id",itemId).maybeSingle():Promise.resolve({data:null,error:null}),
    stockUnitId?db.from("inventory_stock_units").select("id,short_code,lot_code,expires_on,remaining_quantity,status").eq("organization_id",ctx.organizationId).eq("id",stockUnitId).maybeSingle():Promise.resolve({data:null,error:null})
  ]);
  if(ie||pe||be||sue)dbFail(ie||pe||be||sue,"consumption_context",requestId);
  return{
    ...data,
    movementOnHand:data?.onHand==null?null:Number(data.onHand),
    onHand:balance?.on_hand==null?(data?.onHand==null?null:Number(data.onHand)):Number(balance.on_hand),
    item:item?{
      ...item,
      defaultConsumeQuantity:item.default_consume_quantity==null?null:Number(item.default_consume_quantity),
      expiryTracking:Boolean(item.expiry_tracking),
      defaultShelfLifeDays:item.default_shelf_life_days==null?null:Number(item.default_shelf_life_days),
      expiryAlertDays:Number(item.expiry_alert_days||0)
    }:null,
    pack:pack?{...pack,baseQuantity:Number(pack.base_quantity)}:null,
    lotCode:stockUnit?.lot_code??data?.lotCode??null,
    expiresOn:stockUnit?.expires_on??data?.expiresOn??null,
    shortCode:stockUnit?.short_code??data?.shortCode??null
  };
}

function consumeFailure(error:any,requestId:string,scope:string){
  const m=String(error?.message||"");
  if(m.includes("already_used"))fail(409,"qr_already_used","Diese Einheit wurde bereits verwendet oder gehört zu einem anderen Standort.");
  if(m.includes("not_found"))fail(404,"qr_not_found","Kurzcode wurde nicht gefunden.");
  if(m.includes("partial_quantity_required"))fail(409,"qr_partial_quantity_required","Für diese Verpackung muss eine Verbrauchsmenge angegeben werden.");
  if(m.includes("partial_quantity_invalid"))fail(409,"qr_partial_quantity_invalid","Die Menge ist größer als der Rest in dieser Verpackung oder ungültig.");
  if(m.includes("partial_not_allowed"))fail(409,"qr_partial_not_allowed","Dieser Artikel wird immer als ganze Verpackung gebucht.");
  if(m.includes("balance_invariant"))fail(409,"qr_balance_conflict","Bestand und QR-Einheit passen nicht mehr zusammen. Bitte Inventur prüfen.");
  dbFail(error,scope,requestId);
}

export async function startInventoryCount(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"adjust",requestId);
  await requireFeature(ctx,"inventory_counting",locationId,requestId);
  const itemIds=Array.isArray(body.itemIds)?[...new Set(body.itemIds.map((id:any)=>asUuid(id,"item")))]:[];
  if(itemIds.length>100)fail(400,"count_item_scope_invalid","Bitte höchstens 100 Artikel für eine Schnellinventur auswählen.");
  const scope=String(body.scope||(itemIds.length?"targeted":"all")).slice(0,80);
  const rpc=itemIds.length?"aora_inventory_start_count_items":"aora_inventory_start_count";
  const args=itemIds.length?{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_item_ids:itemIds,
    p_scope:scope,
    p_actor_id:ctx.subjectId
  }:{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_scope:scope,
    p_actor_id:ctx.subjectId
  };
  const{data,error}=await db.rpc(rpc,args);
  if(error){
    const m=String(error.message||"");
    if(m.includes("item_scope_invalid"))fail(400,"count_item_scope_invalid","Die ausgewählten Artikel können an diesem Standort nicht gezählt werden.");
    dbFail(error,"start_count",requestId);
  }
  return{...data,serverTime:new Date().toISOString()};
}

export async function getInventoryCount(ctx:InventoryContext,body:any,requestId:string){
  const countId=asUuid(body.countId,"count");
  const{data:count,error}=await db.from("inventory_counts")
    .select("*")
    .eq("organization_id",ctx.organizationId)
    .eq("id",countId)
    .single();
  if(error)dbFail(error,"count",requestId);
  await requirePermission(ctx,String(count.location_id),"adjust",requestId);

  const{data:lines,error:le}=await db.from("inventory_count_lines")
    .select("item_id,system_quantity,counted_quantity,variance,baseline_version,baseline_captured_at,client_counted_at,baseline_reconstructed,updated_at")
    .eq("organization_id",ctx.organizationId)
    .eq("count_id",countId)
    .order("item_id");
  if(le)dbFail(le,"count_lines",requestId);

  const ids=(lines||[]).map((r:any)=>r.item_id);
  const{data:items,error:ie}=ids.length
    ?await db.from("inventory_items").select("id,name,sku,base_uom,category").eq("organization_id",ctx.organizationId).in("id",ids)
    :{data:[],error:null};
  if(ie)dbFail(ie,"count_items",requestId);
  const im=new Map((items||[]).map((i:any)=>[String(i.id),i]));

  return{
    count,
    serverTime:new Date().toISOString(),
    lines:(lines||[]).map((l:any)=>({
      ...l,
      systemQuantity:Number(l.system_quantity),
      countedQuantity:l.counted_quantity==null?null:Number(l.counted_quantity),
      variance:l.variance==null?null:Number(l.variance),
      baselineVersion:l.baseline_version==null?null:Number(l.baseline_version),
      baselineCapturedAt:l.baseline_captured_at||null,
      clientCountedAt:l.client_counted_at||null,
      baselineReconstructed:Boolean(l.baseline_reconstructed),
      item:im.get(String(l.item_id))
    }))
  };
}

export async function setInventoryCountLine(ctx:InventoryContext,body:any,requestId:string){
  const countId=asUuid(body.countId,"count"),itemId=asUuid(body.itemId,"item"),qty=Number(body.countedQuantity);
  if(!Number.isFinite(qty)||qty<0||qty>1_000_000_000)fail(400,"count_quantity_invalid","Gezählte Menge ist ungültig.");
  let countedAt:null|string=null;
  if(body.countedAt!=null&&body.countedAt!==""){
    const d=new Date(String(body.countedAt));
    if(Number.isNaN(d.getTime()))fail(400,"count_timestamp_invalid","Zeitpunkt der Offline-Zählung ist ungültig.");
    countedAt=d.toISOString();
  }

  const{data:count,error}=await db.from("inventory_counts")
    .select("location_id,status")
    .eq("organization_id",ctx.organizationId)
    .eq("id",countId)
    .single();
  if(error)dbFail(error,"count_line_count",requestId);
  await requirePermission(ctx,String(count.location_id),"adjust",requestId);
  if(count.status!=="counting")fail(409,"count_state_invalid","Zählung kann nicht mehr bearbeitet werden.");

  const{data,error:ue}=await db.rpc("aora_inventory_set_count_line_at",{
    p_organization_id:ctx.organizationId,
    p_count_id:countId,
    p_item_id:itemId,
    p_counted_quantity:qty,
    p_actor_id:ctx.subjectId,
    p_counted_at:countedAt
  });
  if(ue){
    const m=String(ue.message||"");
    if(m.includes("count_state_invalid"))fail(409,"count_state_invalid","Zählung kann nicht mehr bearbeitet werden.");
    if(m.includes("count_line_not_found"))fail(404,"count_line_not_found","Dieser Artikel gehört nicht zu dieser Zählung.");
    if(m.includes("balance_not_found"))fail(409,"count_balance_missing","Für diesen Artikel fehlt ein aktueller Bestand. Bitte Bestand aktualisieren.");
    if(m.includes("timestamp_invalid"))fail(409,"count_timestamp_invalid","Die Offline-Zählung ist zu alt oder die Gerätezeit stimmt nicht. Bitte diese Position erneut zählen.");
    if(m.includes("history_invariant"))fail(409,"count_history_conflict","Die Offline-Zählung konnte nicht sicher rekonstruiert werden. Bitte diese Position erneut zählen.");
    dbFail(ue,"set_count_line",requestId);
  }
  return data;
}

export async function postInventoryCount(ctx:InventoryContext,body:any,requestId:string){
  const countId=asUuid(body.countId,"count");
  const{data:count,error}=await db.from("inventory_counts")
    .select("location_id,version")
    .eq("organization_id",ctx.organizationId)
    .eq("id",countId)
    .single();
  if(error)dbFail(error,"post_count_load",requestId);
  await requirePermission(ctx,String(count.location_id),"adjust",requestId);

  const{data,error:pe}=await db.rpc("aora_inventory_post_count",{
    p_organization_id:ctx.organizationId,
    p_count_id:countId,
    p_actor_id:ctx.subjectId,
    p_actor_role:ctx.accessRole,
    p_expected_version:Number(body.expectedVersion||count.version)
  });
  if(pe){
    const m=String(pe.message||"");
    if(m.includes("baseline_required"))fail(409,"count_baseline_required","Einige Positionen müssen erneut physisch gezählt werden.");
    if(m.includes("incomplete"))fail(409,"count_incomplete","Bitte zuerst alle Artikel zählen.");
    if(m.includes("conflict"))fail(409,"count_conflict","Die Zählung wurde bereits geändert. Bitte aktualisieren.");
    dbFail(pe,"post_count",requestId);
  }
  return data;
}

export async function receivePurchaseOrderDelivery(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"receipt",requestId);
  const lines=Array.isArray(body.lines)?body.lines.map((line:any)=>({
    item_id:asUuid(line.itemId,"item"),
    pack_unit_id:asUuid(line.packUnitId,"pack_unit"),
    good_pack_count:Math.trunc(Number(line.goodPackCount||0)),
    damaged_pack_count:Math.trunc(Number(line.damagedPackCount||0)),
    missing_pack_count:Math.trunc(Number(line.missingPackCount||0)),
    note:String(line.note||"").slice(0,500),
    lot_code:String(line.lotCode||"").trim().slice(0,80)||null,
    expires_on:line.expiresOn?String(line.expiresOn):null
  })):[];
  if(!lines.length)fail(400,"receipt_lines_invalid","Bitte mindestens eine Position angeben.");
  if(lines.some((line:any)=>[line.good_pack_count,line.damaged_pack_count,line.missing_pack_count].some((n:number)=>!Number.isSafeInteger(n)||n<0)))fail(400,"receipt_quantity_invalid","Liefermengen sind ungültig.");
  if(lines.some((line:any)=>line.expires_on&&!/^\d{4}-\d{2}-\d{2}$/.test(line.expires_on)))fail(400,"expiry_invalid","MHD ist ungültig.");
  const{data,error}=await db.rpc("aora_inventory_receive_purchase_order_delivery",{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_purchase_order_id:asUuid(body.purchaseOrderId,"purchase_order"),
    p_lines:lines,
    p_actor_id:ctx.subjectId,
    p_actor_role:ctx.accessRole,
    p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error){
    const m=String(error.message||"");
    if(m.includes("quantity_exceeded"))fail(409,"purchase_order_quantity_exceeded","Die erfassten Mengen überschreiten die noch offene Bestellmenge.");
    if(m.includes("not_receivable"))fail(409,"purchase_order_not_receivable","Diese Bestellung kann nicht mehr angenommen werden.");
    if(m.includes("pack_unit_not_found"))fail(404,"pack_unit_not_found","Die Bestellverpackung wurde nicht gefunden.");
    if(m.includes("expiry_required"))fail(409,"expiry_required","Für diesen MHD-Artikel muss beim Wareneingang ein Ablaufdatum erfasst werden.");
    if(m.includes("expiry_in_past"))fail(409,"expiry_in_past","Das MHD liegt in der Vergangenheit. Lieferung bitte als Abweichung prüfen.");
    dbFail(error,"receive_purchase_order_delivery",requestId);
  }
  return data;
}

export async function receivePurchaseOrderLine(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"receipt",requestId);
  const{data,error}=await db.rpc("aora_inventory_receive_purchase_order_line",{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_purchase_order_id:asUuid(body.purchaseOrderId,"purchase_order"),
    p_item_id:asUuid(body.itemId,"item"),
    p_pack_unit_id:asUuid(body.packUnitId,"pack_unit"),
    p_pack_count:Math.trunc(Number(body.packCount)),
    p_actor_id:ctx.subjectId,
    p_actor_role:ctx.accessRole,
    p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error){
    if(String(error.message).includes("quantity_exceeded"))fail(409,"purchase_order_quantity_exceeded","Die eingegangene Menge überschreitet die offene Bestellmenge.");
    if(String(error.message).includes("not_receivable"))fail(409,"purchase_order_not_receivable","Diese Bestellung kann nicht mehr angenommen werden.");
    dbFail(error,"receive_po",requestId);
  }
  return data;
}

export async function issueQrShortCode(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"consume",requestId);
  if(ctx.accessRole==="employee"){
    await requireFeature(ctx,"inventory_qr",locationId,requestId);
    await requireFeature(ctx,"inventory_employee_scan",locationId,requestId);
  }
  const code=String(body.shortCode||"").trim();
  if(code.length<6||code.length>24)fail(400,"short_code_invalid","Kurzcode ist ungültig.");
  const requested=body.quantity==null||body.quantity===""?null:Number(body.quantity);
  if(requested!=null&&(!Number.isFinite(requested)||requested<=0||requested>1_000_000_000))fail(400,"qr_partial_quantity_invalid","Verbrauchsmenge ist ungültig.");
  const{data,error}=await db.rpc("aora_inventory_consume_qr_short_code",{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_short_code:code,
    p_requested_quantity:requested,
    p_actor_id:ctx.subjectId,
    p_actor_role:ctx.accessRole,
    p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error)consumeFailure(error,requestId,"short_code");
  return enrichConsumption(ctx,data,locationId,requestId);
}
