import {db,dbFail,fail,asUuid,idem,requirePermission,requireFeature,type InventoryContext} from "./lib.ts";

export async function listExpiredStockUnits(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"waste",requestId);
  await requireFeature(ctx,"inventory_qr",locationId,requestId);
  if(!["owner","manager"].includes(ctx.accessRole))fail(403,"manager_required","Nur Manager oder Inhaber dürfen abgelaufene QR-Einheiten ausbuchen.");

  const today=new Date().toISOString().slice(0,10);
  const{data:units,error}=await db.from("inventory_stock_units")
    .select("id,item_id,pack_unit_id,short_code,remaining_quantity,lot_code,expires_on,created_at")
    .eq("organization_id",ctx.organizationId)
    .eq("location_id",locationId)
    .eq("status","available")
    .gt("remaining_quantity",0)
    .not("expires_on","is",null)
    .lt("expires_on",today)
    .order("expires_on",{ascending:true})
    .order("created_at",{ascending:true})
    .limit(250);
  if(error)dbFail(error,"expired_stock_units",requestId);
  const itemIds=[...new Set((units||[]).map((row:any)=>String(row.item_id)))];
  const packIds=[...new Set((units||[]).map((row:any)=>String(row.pack_unit_id)))];
  const[{data:items,error:ie},{data:packs,error:pe}]=await Promise.all([
    itemIds.length?db.from("inventory_items").select("id,name,sku,base_uom").eq("organization_id",ctx.organizationId).in("id",itemIds):Promise.resolve({data:[],error:null}),
    packIds.length?db.from("inventory_pack_units").select("id,label,code,base_quantity").eq("organization_id",ctx.organizationId).in("id",packIds):Promise.resolve({data:[],error:null})
  ]);
  if(ie||pe)dbFail(ie||pe,"expired_stock_context",requestId);
  const itemMap=new Map((items||[]).map((row:any)=>[String(row.id),row])),packMap=new Map((packs||[]).map((row:any)=>[String(row.id),row]));
  return{
    locationId,
    asOfDate:today,
    units:(units||[]).map((unit:any)=>({
      id:String(unit.id),itemId:String(unit.item_id),packUnitId:String(unit.pack_unit_id),shortCode:String(unit.short_code||""),
      remainingQuantity:Number(unit.remaining_quantity||0),lotCode:unit.lot_code||null,expiresOn:unit.expires_on||null,
      item:itemMap.get(String(unit.item_id))||null,
      pack:packMap.get(String(unit.pack_unit_id))||null
    }))
  };
}

export async function wasteExpiredStockUnit(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"waste",requestId);
  await requireFeature(ctx,"inventory_qr",locationId,requestId);
  if(!["owner","manager"].includes(ctx.accessRole))fail(403,"manager_required","Nur Manager oder Inhaber dürfen abgelaufene QR-Einheiten ausbuchen.");
  const{data,error}=await db.rpc("aora_inventory_waste_expired_stock_unit",{
    p_organization_id:ctx.organizationId,
    p_location_id:locationId,
    p_stock_unit_id:asUuid(body.stockUnitId,"stock_unit"),
    p_actor_id:ctx.subjectId,
    p_actor_role:ctx.accessRole,
    p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error){
    const m=String(error.message||"");
    if(m.includes("not_expired"))fail(409,"stock_unit_not_expired","Diese Einheit ist nicht abgelaufen und wurde nicht ausgebucht.");
    if(m.includes("expiry_missing"))fail(409,"stock_unit_expiry_missing","Für diese Einheit fehlt ein MHD. Bitte physisch prüfen.");
    if(m.includes("already_used"))fail(409,"qr_already_used","Diese Einheit wurde bereits verbraucht oder ausgebucht.");
    if(m.includes("wrong_location"))fail(403,"qr_wrong_location","Diese Einheit gehört nicht zu diesem Standort.");
    if(m.includes("balance_invariant"))fail(409,"qr_balance_conflict","Bestand und QR-Einheit passen nicht mehr zusammen. Bitte Inventur prüfen.");
    dbFail(error,"waste_expired_stock_unit",requestId);
  }
  return data;
}
