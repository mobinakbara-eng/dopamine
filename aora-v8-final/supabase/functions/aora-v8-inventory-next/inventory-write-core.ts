import {db,dbFail,fail,asUuid,idem,positive,requirePermission,type InventoryContext} from "./lib.ts";

export async function createItem(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"adjust",requestId);
  const{data,error}=await db.rpc("aora_inventory_create_item",{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_sku:String(body.sku||""),
    p_barcode:String(body.barcode||""),
    p_name:String(body.name||""),
    p_base_uom:String(body.baseUom||"piece"),
    p_category:String(body.category||""),
    p_reorder_point:Math.max(0,Number(body.reorderPoint||0)),
    p_actor_id:ctx.subjectId
  });
  if(error){
    if(String(error.message).includes("duplicate"))fail(409,"item_duplicate","SKU oder Barcode ist bereits vorhanden.");
    dbFail(error,"create_item",requestId);
  }
  return data;
}

export async function createProductBundle(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"adjust",requestId);
  if(body.supplierId)await requirePermission(ctx,locationId,"procurement",requestId);
  const supplierId=body.supplierId?asUuid(body.supplierId,"supplier"):null;
  const price=body.unitPrice==null||body.unitPrice===""?null:Number(body.unitPrice);
  const{data,error}=await db.rpc("aora_inventory_create_product_bundle",{
    p_organization_id:ctx.organizationId,p_location_id:locationId,p_sku:String(body.sku||""),p_barcode:String(body.barcode||""),p_name:String(body.name||""),
    p_base_uom:String(body.baseUom||"piece"),p_category:String(body.category||""),p_reorder_point:Math.max(0,Number(body.reorderPoint||0)),p_pack_code:String(body.packCode||""),p_pack_label:String(body.packLabel||""),
    p_pack_base_quantity:positive(body.baseQuantity),p_is_stock_unit:Boolean(body.isStockUnit),p_is_order_unit:Boolean(body.isOrderUnit),p_supplier_id:supplierId,p_supplier_sku:String(body.supplierSku||""),
    p_unit_price:price,p_currency:String(body.currency||"EUR"),p_minimum_order_quantity:positive(body.minimumOrderQuantity??1),p_order_multiple:positive(body.orderMultiple??1),p_actor_id:ctx.subjectId,p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error){
    const message=String(error.message||"");
    if(message.includes("duplicate"))fail(409,"product_bundle_duplicate","Produkt, Verpackung oder Lieferantenzuordnung existiert bereits.");
    dbFail(error,"create_product_bundle",requestId);
  }
  return data;
}

export async function recordMovement(ctx:InventoryContext,body:any,kind:string,requestId:string){
  const locationId=String(body.locationId||"");
  const perm=kind==="receipt"?"receipt":kind==="consumption"?"consume":kind==="waste"?"waste":"adjust";
  await requirePermission(ctx,locationId,perm,requestId);
  if(ctx.accessRole==="employee"&&kind!=="consumption")fail(403,"employee_action_forbidden","Mitarbeiter dürfen nur freigegebene QR-Einheiten verbrauchen.");
  const{data,error}=await db.rpc("aora_inventory_apply_movement",{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_item_id:asUuid(body.itemId,"item"),
    p_kind:kind,
    p_quantity:positive(Math.abs(Number(body.quantity))),
    p_reason_code:String(body.reason||""),
    p_reference_type:String(body.referenceType||"manual"),
    p_reference_id:String(body.referenceId||""),
    p_actor_id:ctx.subjectId,
    p_actor_role:ctx.accessRole,
    p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error){
    const m=String(error.message||"");
    if(m.includes("insufficient_stock"))fail(409,"insufficient_stock","Der verfügbare Bestand reicht nicht aus.");
    if(m.includes("item_location_not_found"))fail(404,"item_not_found","Artikel wurde an diesem Standort nicht gefunden.");
    dbFail(error,"movement",requestId);
  }
  return data;
}

export async function createTransfer(ctx:InventoryContext,body:any,requestId:string){
  const source=String(body.sourceLocationId||""),dest=String(body.destinationLocationId||"");
  await requirePermission(ctx,source,"transfer_dispatch",requestId);
  await requirePermission(ctx,dest,"transfer_receive",requestId);
  const lines=Array.isArray(body.lines)?body.lines.map((l:any)=>({item_id:asUuid(l.itemId,"item"),quantity:positive(l.quantity)})):[];
  const{data,error}=await db.rpc("aora_inventory_create_transfer",{
    p_organization_id:ctx.organizationId,
    p_source_location_id:source,
    p_destination_location_id:dest,
    p_lines:lines,
    p_note:String(body.note||""),
    p_actor_id:ctx.subjectId,
    p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error)dbFail(error,"create_transfer",requestId);
  return data;
}

export async function createAutopilotTransfer(ctx:InventoryContext,body:any,requestId:string){
  const source=String(body.sourceLocationId||""),dest=String(body.destinationLocationId||"");
  await requirePermission(ctx,source,"transfer_dispatch",requestId);
  await requirePermission(ctx,dest,"transfer_receive",requestId);
  const lines=Array.isArray(body.lines)?body.lines.map((l:any)=>({item_id:asUuid(l.itemId,"item"),quantity:positive(l.quantity)})):[];
  const episodeId=body.replenishmentEpisodeId?asUuid(body.replenishmentEpisodeId,"replenishment_episode"):null;
  const{data,error}=await db.rpc("aora_inventory_create_autopilot_transfer",{
    p_organization_id:ctx.organizationId,
    p_source_location_id:source,
    p_destination_location_id:dest,
    p_lines:lines,
    p_note:String(body.note||"Aora Autopilot: Transfer vor Einkauf"),
    p_actor_id:ctx.subjectId,
    p_idempotency_key:idem(body.idempotencyKey),
    p_replenishment_episode_id:episodeId
  });
  if(error){
    const m=String(error.message||"");
    if(m.includes("source_floor_changed"))fail(409,"transfer_source_floor_changed","Der sichere Überschuss am Ausgangsstandort hat sich geändert. Bitte Vorschlag aktualisieren.");
    if(m.includes("insufficient_stock"))fail(409,"insufficient_stock","Der Bestand am Ausgangsstandort reicht nicht mehr aus.");
    dbFail(error,"create_autopilot_transfer",requestId);
  }
  return data;
}

export async function changeTransfer(ctx:InventoryContext,body:any,action:"dispatch"|"receive"|"cancel",requestId:string){
  const id=asUuid(body.transferId,"transfer");
  const{data:t,error:re}=await db.from("inventory_transfers").select("source_location_id,destination_location_id").eq("organization_id",ctx.organizationId).eq("id",id).maybeSingle();
  if(re)dbFail(re,"load_transfer",requestId);
  if(!t)fail(404,"transfer_not_found","Transfer wurde nicht gefunden.");
  const locationId=action==="receive"?String(t.destination_location_id):String(t.source_location_id);
  await requirePermission(ctx,locationId,action==="receive"?"transfer_receive":"transfer_dispatch",requestId);
  const rpc=action==="dispatch"?"aora_inventory_dispatch_transfer":action==="receive"?"aora_inventory_receive_transfer":"aora_inventory_cancel_transfer";
  const args:any={p_organization_id:ctx.organizationId,p_transfer_id:id,p_expected_version:Number(body.expectedVersion),p_actor_id:ctx.subjectId};
  if(action!=="cancel"){
    args.p_actor_role=ctx.accessRole;
    args.p_idempotency_key=idem(body.idempotencyKey);
  }
  const{data,error}=await db.rpc(rpc,args);
  if(error){
    const m=String(error.message||"");
    if(m.includes("source_floor_changed"))fail(409,"transfer_source_floor_changed","Der Bestand am Ausgangsstandort hat sich geändert. Bitte Transfer aktualisieren oder neu planen.");
    if(m.includes("insufficient_stock"))fail(409,"insufficient_stock","Der Bestand am Ausgangsstandort reicht nicht aus.");
    if(m.includes("version_conflict")||m.includes("state_invalid"))fail(409,"transfer_conflict","Der Transfer wurde bereits geändert. Bitte aktualisieren.");
    dbFail(error,`${action}_transfer`,requestId);
  }
  return data;
}

export async function createPackUnit(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"adjust",requestId);
  const row={
    organization_id:ctx.organizationId,
    item_id:asUuid(body.itemId,"item"),
    code:String(body.code||"").trim().toUpperCase().slice(0,40),
    label:String(body.label||"").trim().slice(0,100),
    base_quantity:positive(body.baseQuantity),
    is_stock_unit:Boolean(body.isStockUnit),
    is_order_unit:Boolean(body.isOrderUnit)
  };
  if(!row.code||!row.label)fail(400,"pack_unit_invalid","Bezeichnung und Code fehlen.");
  const{data,error}=await db.from("inventory_pack_units").insert(row).select("id,code,label,base_quantity,is_stock_unit,is_order_unit").single();
  if(error){
    if(String(error.code)==="23505")fail(409,"pack_unit_duplicate","Diese Verpackungseinheit existiert bereits.");
    dbFail(error,"create_pack_unit",requestId);
  }
  return{...data,baseQuantity:Number(data.base_quantity)};
}
