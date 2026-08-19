import {db,dbFail,hasPermission,requirePermission,type InventoryContext} from "./lib.ts";

export async function listTransfers(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"view",requestId);
  const{data,error}=await db.from("inventory_transfers")
    .select("id,source_location_id,destination_location_id,status,note,version,created_at,dispatched_at,received_at")
    .eq("organization_id",ctx.organizationId)
    .or(`source_location_id.eq.${locationId},destination_location_id.eq.${locationId}`)
    .order("created_at",{ascending:false})
    .limit(150);
  if(error)dbFail(error,"transfers",requestId);
  return{locationId,transfers:data||[]};
}

export async function listTransferSuggestions(ctx:InventoryContext,body:any,requestId:string){
  const destinationLocationId=String(body.locationId||"");
  await requirePermission(ctx,destinationLocationId,"transfer_receive",requestId);

  const possibleSources=ctx.locationIds.filter(id=>id!==destinationLocationId);
  if(!possibleSources.length)return{locationId:destinationLocationId,suggestions:[]};

  const sourceLocationIds:string[]=[];
  for(const locationId of possibleSources){
    if(await hasPermission(ctx,locationId,"transfer_dispatch",requestId))sourceLocationIds.push(locationId);
  }
  if(!sourceLocationIds.length)return{locationId:destinationLocationId,suggestions:[]};

  const{data:states,error:se}=await db.from("inventory_replenishment_state")
    .select("item_id,episode_id,suggested_base_quantity,updated_at")
    .eq("organization_id",ctx.organizationId)
    .eq("location_id",destinationLocationId)
    .eq("below_threshold",true)
    .gt("suggested_base_quantity",0);
  if(se)dbFail(se,"transfer_suggestion_replenishment",requestId);
  if(!states?.length)return{locationId:destinationLocationId,suggestions:[]};

  const itemIds=[...new Set(states.map((r:any)=>String(r.item_id)))];
  const[
    {data:items,error:ie},
    {data:locations,error:le},
    {data:balances,error:be},
    {data:policies,error:pe},
    {data:draftTransfers,error:te}
  ]=await Promise.all([
    db.from("inventory_items").select("id,name,sku,base_uom,category").eq("organization_id",ctx.organizationId).in("id",itemIds),
    db.from("locations").select("id,name,city").eq("organization_id",ctx.organizationId).in("id",sourceLocationIds).eq("active",true).is("deleted_at",null),
    db.from("inventory_balances").select("location_id,item_id,on_hand,reserved").eq("organization_id",ctx.organizationId).in("location_id",sourceLocationIds).in("item_id",itemIds),
    db.from("inventory_item_locations").select("location_id,item_id,reorder_point,par_level").eq("organization_id",ctx.organizationId).eq("active",true).in("location_id",sourceLocationIds).in("item_id",itemIds),
    db.from("inventory_transfers").select("id").eq("organization_id",ctx.organizationId).eq("destination_location_id",destinationLocationId).eq("status","draft")
  ]);
  if(ie||le||be||pe||te)dbFail(ie||le||be||pe||te,"transfer_suggestion_context",requestId);

  const draftIds=(draftTransfers||[]).map((r:any)=>r.id);
  const{data:draftLines,error:dle}=draftIds.length?await db.from("inventory_transfer_lines").select("item_id,requested_quantity").eq("organization_id",ctx.organizationId).in("transfer_id",draftIds).in("item_id",itemIds):{data:[],error:null};
  if(dle)dbFail(dle,"transfer_suggestion_drafts",requestId);

  const itemMap=new Map((items||[]).map((r:any)=>[String(r.id),r]));
  const locationMap=new Map((locations||[]).map((r:any)=>[String(r.id),r]));
  const policyMap=new Map((policies||[]).map((r:any)=>[`${r.location_id}:${r.item_id}`,r]));
  const draftIncoming=new Map<string,number>();
  for(const line of draftLines||[]){const key=String(line.item_id);draftIncoming.set(key,(draftIncoming.get(key)||0)+Number(line.requested_quantity||0))}

  const suggestions:any[]=[];
  for(const state of states){
    const itemId=String(state.item_id),item:any=itemMap.get(itemId),alreadyRequested=Math.max(0,draftIncoming.get(itemId)||0),rawNeed=Math.max(0,Number(state.suggested_base_quantity||0)),need=Math.max(0,rawNeed-alreadyRequested);
    if(need<=0)continue;
    const candidates:any[]=[];
    for(const balance of balances||[]){
      if(String(balance.item_id)!==itemId)continue;
      const sourceLocationId=String(balance.location_id),location:any=locationMap.get(sourceLocationId);if(!location)continue;
      const policy:any=policyMap.get(`${sourceLocationId}:${itemId}`);if(!policy)continue;
      const sourceAvailable=Math.max(0,Number(balance.on_hand||0)-Number(balance.reserved||0)),sourceFloor=Math.max(Number(policy.reorder_point||0),Number(policy.par_level??0)),surplus=Math.max(0,sourceAvailable-sourceFloor);if(surplus<=0)continue;
      candidates.push({sourceLocationId,sourceLocationName:String(location.name||sourceLocationId),sourceCity:String(location.city||""),sourceOnHand:Number(balance.on_hand||0),sourceReserved:Number(balance.reserved||0),sourceSafetyFloor:sourceFloor,transferableQuantity:surplus});
    }
    candidates.sort((a,b)=>b.transferableQuantity-a.transferableQuantity||a.sourceLocationName.localeCompare(b.sourceLocationName,"de"));if(!candidates.length)continue;
    const totalTransferable=candidates.reduce((sum,x)=>sum+Number(x.transferableQuantity||0),0),best=candidates[0],recommendedQuantity=Math.min(need,Number(best.transferableQuantity||0));if(recommendedQuantity<=0)continue;
    suggestions.push({itemId,episodeId:state.episode_id||null,item:item||null,needQuantity:need,rawNeedQuantity:rawNeed,alreadyRequestedQuantity:alreadyRequested,totalTransferableQuantity:totalTransferable,canFullyCover:totalTransferable>=need,recommendedSourceLocationId:best.sourceLocationId,recommendedSourceLocationName:best.sourceLocationName,recommendedQuantity,remainingAfterRecommendation:Math.max(0,need-recommendedQuantity),candidates,updatedAt:state.updated_at||null});
  }
  suggestions.sort((a,b)=>Number(b.canFullyCover)-Number(a.canFullyCover)||b.recommendedQuantity-a.recommendedQuantity);
  return{locationId:destinationLocationId,suggestions};
}

export async function listPurchaseOrders(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const{data:orders,error}=await db.from("inventory_purchase_orders").select("id,supplier_id,status,expected_on,note,version,order_number,delivery_channel,provider_message_id,provider_status,last_error,created_at,submitted_at,sent_at,received_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).order("created_at",{ascending:false}).limit(150);
  if(error)dbFail(error,"purchase_orders",requestId);
  const orderIds=(orders||[]).map((r:any)=>r.id);if(!orderIds.length)return{locationId,orders:[]};
  const supplierIds=[...new Set((orders||[]).map((r:any)=>r.supplier_id))];
  const[{data:lines,error:le},{data:suppliers,error:se}]=await Promise.all([
    db.from("inventory_purchase_order_lines").select("purchase_order_id,item_id,ordered_quantity,received_quantity,unit_cost,supplier_item_id,pack_unit_id,ordered_pack_quantity,supplier_sku,supplier_item_name").eq("organization_id",ctx.organizationId).in("purchase_order_id",orderIds),
    db.from("inventory_suppliers").select("id,name,contact").eq("organization_id",ctx.organizationId).in("id",supplierIds)
  ]);
  if(le||se)dbFail(le||se,"purchase_order_context",requestId);
  const itemIds=[...new Set((lines||[]).map((r:any)=>r.item_id))],packIds=[...new Set((lines||[]).map((r:any)=>r.pack_unit_id).filter(Boolean))];
  const[{data:items,error:ie},{data:packs,error:pe}]=await Promise.all([
    itemIds.length?db.from("inventory_items").select("id,name,sku,base_uom,expiry_tracking,default_shelf_life_days,expiry_alert_days").eq("organization_id",ctx.organizationId).in("id",itemIds):Promise.resolve({data:[],error:null}),
    packIds.length?db.from("inventory_pack_units").select("id,label,code,base_quantity,is_stock_unit").eq("organization_id",ctx.organizationId).in("id",packIds):Promise.resolve({data:[],error:null})
  ]);
  if(ie||pe)dbFail(ie||pe,"purchase_order_items",requestId);
  const sm=new Map((suppliers||[]).map((r:any)=>[String(r.id),r])),im=new Map((items||[]).map((r:any)=>[String(r.id),r])),pm=new Map((packs||[]).map((r:any)=>[String(r.id),r]));
  return{locationId,orders:(orders||[]).map((o:any)=>({...o,supplier:sm.get(String(o.supplier_id))||null,lines:(lines||[]).filter((l:any)=>String(l.purchase_order_id)===String(o.id)).map((l:any)=>{
    const item:any=im.get(String(l.item_id))||null,pack:any=pm.get(String(l.pack_unit_id))||null;
    return{...l,orderedQuantity:Number(l.ordered_quantity),receivedQuantity:Number(l.received_quantity),orderedPackQuantity:l.ordered_pack_quantity==null?null:Number(l.ordered_pack_quantity),unitCost:l.unit_cost==null?null:Number(l.unit_cost),item:item?{...item,expiryTracking:Boolean(item.expiry_tracking),defaultShelfLifeDays:item.default_shelf_life_days==null?null:Number(item.default_shelf_life_days),expiryAlertDays:Number(item.expiry_alert_days||0)}:null,pack:pack?{...pack,baseQuantity:Number(pack.base_quantity),isStockUnit:Boolean(pack.is_stock_unit)}:null};
  })}))};
}

export async function listPackUnits(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");await requirePermission(ctx,locationId,"view",requestId);
  const{data,error}=await db.from("inventory_pack_units").select("id,item_id,code,label,base_quantity,is_stock_unit,is_order_unit,active").eq("organization_id",ctx.organizationId).eq("item_id",String(body.itemId||"")).eq("active",true).order("base_quantity");
  if(error)dbFail(error,"pack_units",requestId);return{packUnits:(data||[]).map((r:any)=>({...r,baseQuantity:Number(r.base_quantity)}))};
}

export async function listPrintJobs(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");await requirePermission(ctx,locationId,"receipt",requestId);
  const{data,error}=await db.from("inventory_label_print_jobs").select("id,receipt_id,purchase_order_id,item_id,pack_unit_id,label_count,status,generation,lot_code,expires_on,prepared_at,printed_at,created_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).in("status",["pending","prepared"]).order("created_at",{ascending:false}).limit(150);
  if(error)dbFail(error,"print_jobs",requestId);
  const ids=[...new Set((data||[]).map((r:any)=>r.item_id))];const{data:items,error:ie}=ids.length?await db.from("inventory_items").select("id,name,sku,base_uom").eq("organization_id",ctx.organizationId).in("id",ids):{data:[],error:null};if(ie)dbFail(ie,"print_job_items",requestId);
  const im=new Map((items||[]).map((r:any)=>[String(r.id),r]));return{locationId,jobs:(data||[]).map((r:any)=>({...r,labelCount:Number(r.label_count),generation:Number(r.generation),lotCode:r.lot_code||null,expiresOn:r.expires_on||null,item:im.get(String(r.item_id))||null}))};
}

export async function listEmployeeAccess(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");await requirePermission(ctx,locationId,"view",requestId);
  const[{data:employees,error:ee},{data:additional,error:ae},{data:grants,error:ge}]=await Promise.all([
    db.from("employees").select("id,name,email,role,role_title,location_id,primary_location_id").eq("organization_id",ctx.organizationId).eq("active",true).is("deleted_at",null),
    db.from("employee_location_access").select("employee_id").eq("organization_id",ctx.organizationId).eq("location_id",locationId),
    db.from("inventory_permission_grants").select("subject_id").eq("organization_id",ctx.organizationId).eq("subject_type","employee").eq("location_id",locationId).eq("permission","consume")
  ]);if(ee||ae||ge)dbFail(ee||ae||ge,"employee_access",requestId);
  const extra=new Set((additional||[]).map((r:any)=>String(r.employee_id))),granted=new Set((grants||[]).map((r:any)=>String(r.subject_id)));
  return{locationId,employees:(employees||[]).filter((r:any)=>[r.primary_location_id,r.location_id].filter(Boolean).map(String).includes(locationId)||extra.has(String(r.id))).map((r:any)=>({id:String(r.id),name:String(r.name||"Mitarbeiter"),email:String(r.email||""),roleTitle:String(r.role_title||r.role||"Mitarbeiter"),scanEnabled:granted.has(String(r.id))})).sort((a:any,b:any)=>a.name.localeCompare(b.name,"de"))};
}

export async function listReplenishment(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");await requirePermission(ctx,locationId,"procurement",requestId);
  const{data,error}=await db.from("inventory_replenishment_state").select("item_id,below_threshold,episode_id,opened_at,suggested_base_quantity,updated_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).eq("below_threshold",true).order("opened_at");
  if(error)dbFail(error,"replenishment",requestId);return{suggestions:(data||[]).map((r:any)=>({...r,suggestedQuantity:Number(r.suggested_base_quantity)}))};
}
