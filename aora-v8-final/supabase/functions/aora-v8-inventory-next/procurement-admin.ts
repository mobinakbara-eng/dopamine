import {db,dbFail,fail,now,asUuid,email,requirePermission,type InventoryContext} from "./lib.ts";

export async function listManagerAccess(ctx:InventoryContext,body:any,requestId:string){
  if(ctx.accessRole!=="owner")fail(403,"owner_required","Nur der Inhaber darf Manager-Berechtigungen ändern.");
  const managerId=String(body.managerId||"");
  const{data,error}=await db.from("inventory_permission_grants").select("location_id,permission").eq("organization_id",ctx.organizationId).eq("subject_type","admin").eq("subject_id",managerId);
  if(error)dbFail(error,"manager_access",requestId);
  return{managerId,grants:data||[],fullLocationIds:[...new Set((data||[]).filter((r:any)=>r.permission==="procurement").map((r:any)=>String(r.location_id)))]};
}

export async function setManagerAccess(ctx:InventoryContext,body:any,requestId:string){
  if(ctx.accessRole!=="owner")fail(403,"owner_required","Nur der Inhaber darf Manager-Berechtigungen ändern.");
  const managerId=String(body.managerId||""),locationIds=Array.isArray(body.locationIds)?body.locationIds.map(String):[];
  const{data,error}=await db.rpc("aora_inventory_set_manager_full_access",{p_organization_id:ctx.organizationId,p_manager_id:managerId,p_location_ids:locationIds,p_actor_id:ctx.subjectId});
  if(error){
    if(String(error.message).includes("manager_location_forbidden"))fail(403,"manager_location_forbidden","Bestand kann nur für bereits zugewiesene Läden freigegeben werden.");
    dbFail(error,"set_manager_access",requestId);
  }
  return data;
}

export async function listSuppliers(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const{data,error}=await db.from("inventory_suppliers").select("id,name,contact,active,version,updated_at").eq("organization_id",ctx.organizationId).eq("active",true).order("name");
  if(error)dbFail(error,"suppliers",requestId);
  return{suppliers:data||[]};
}

export async function upsertSupplier(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const name=String(body.name||"").trim().slice(0,160);
  if(!name)fail(400,"supplier_name_required","Lieferantenname fehlt.");
  const contact={email:email(body.email),whatsapp:String(body.whatsapp||"").trim().slice(0,40),orderingMethod:String(body.orderingMethod||"BOTH").toUpperCase()};
  if(!contact.email&&!contact.whatsapp)fail(400,"supplier_contact_required","Bitte E-Mail oder WhatsApp hinterlegen.");
  if(body.supplierId){
    const{data,error}=await db.from("inventory_suppliers").update({name,contact,updated_by:ctx.subjectId,updated_at:now(),version:Number(body.version||1)+1}).eq("organization_id",ctx.organizationId).eq("id",asUuid(body.supplierId,"supplier")).select("id,name,contact,version").single();
    if(error)dbFail(error,"update_supplier",requestId);
    return data;
  }
  const{data,error}=await db.from("inventory_suppliers").insert({organization_id:ctx.organizationId,name,contact,created_by:ctx.subjectId,updated_by:ctx.subjectId}).select("id,name,contact,version").single();
  if(error){
    if(String(error.code)==="23505")fail(409,"supplier_duplicate","Dieser Lieferant existiert bereits.");
    dbFail(error,"create_supplier",requestId);
  }
  return data;
}

export async function listSupplierItems(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const supplierId=asUuid(body.supplierId,"supplier");
  const{data,error}=await db.from("inventory_supplier_items")
    .select("id,supplier_id,item_id,pack_unit_id,supplier_sku,supplier_item_name,unit_price,currency,minimum_order_quantity,order_multiple,active")
    .eq("organization_id",ctx.organizationId)
    .eq("supplier_id",supplierId)
    .eq("active",true)
    .order("supplier_item_name");
  if(error)dbFail(error,"supplier_items",requestId);

  const itemIds=[...new Set((data||[]).map((r:any)=>r.item_id))],packIds=[...new Set((data||[]).map((r:any)=>r.pack_unit_id).filter(Boolean))];
  const[{data:items,error:ie},{data:packs,error:pe},{data:balances,error:be},{data:policies,error:poe},{data:replenishment,error:re}]=await Promise.all([
    itemIds.length?db.from("inventory_items").select("id,name,sku,base_uom,category").eq("organization_id",ctx.organizationId).in("id",itemIds):Promise.resolve({data:[],error:null}),
    packIds.length?db.from("inventory_pack_units").select("id,label,code,base_quantity,is_order_unit").eq("organization_id",ctx.organizationId).in("id",packIds):Promise.resolve({data:[],error:null}),
    db.from("inventory_balances").select("item_id,on_hand,reserved,in_transit_in").eq("organization_id",ctx.organizationId).eq("location_id",locationId),
    db.from("inventory_item_locations").select("item_id,reorder_point,par_level").eq("organization_id",ctx.organizationId).eq("location_id",locationId),
    db.from("inventory_replenishment_state").select("item_id,below_threshold,suggested_base_quantity,updated_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId)
  ]);
  if(ie||pe||be||poe||re)dbFail(ie||pe||be||poe||re,"supplier_item_context",requestId);

  const im=new Map((items||[]).map((r:any)=>[String(r.id),r])),pm=new Map((packs||[]).map((r:any)=>[String(r.id),r])),bm=new Map((balances||[]).map((r:any)=>[String(r.item_id),r])),pol=new Map((policies||[]).map((r:any)=>[String(r.item_id),r])),rm=new Map((replenishment||[]).map((r:any)=>[String(r.item_id),r]));
  return{items:(data||[]).map((r:any)=>{
    const balance:any=bm.get(String(r.item_id))||{},policy:any=pol.get(String(r.item_id))||{},state:any=rm.get(String(r.item_id))||{};
    return{
      ...r,
      item:im.get(String(r.item_id)),
      pack:pm.get(String(r.pack_unit_id))||null,
      onHand:Number(balance.on_hand||0),
      reserved:Number(balance.reserved||0),
      inTransit:Number(balance.in_transit_in||0),
      reorderPoint:Number(policy.reorder_point||0),
      parLevel:policy.par_level==null?null:Number(policy.par_level),
      belowThreshold:Boolean(state.below_threshold),
      suggestedBaseQuantity:Number(state.suggested_base_quantity||0),
      replenishmentUpdatedAt:state.updated_at||null
    };
  })};
}

export async function upsertSupplierItem(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const supplierId=asUuid(body.supplierId,"supplier"),itemId=asUuid(body.itemId,"item"),packUnitId=body.packUnitId?asUuid(body.packUnitId,"pack_unit"):null;
  const minimum=Number(body.minimumOrderQuantity??1),multiple=Number(body.orderMultiple??1),price=body.unitPrice==null||body.unitPrice===""?null:Number(body.unitPrice);
  if(!Number.isFinite(minimum)||minimum<=0||!Number.isFinite(multiple)||multiple<=0)fail(400,"supplier_order_rules_invalid","Mindestmenge und Bestellschritt müssen größer als 0 sein.");
  if(price!=null&&(!Number.isFinite(price)||price<0))fail(400,"supplier_price_invalid","Preis ist ungültig.");
  const currency=String(body.currency||"EUR").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))fail(400,"supplier_currency_invalid","Währung muss aus drei Buchstaben bestehen.");
  const row:any={
    organization_id:ctx.organizationId,
    supplier_id:supplierId,
    item_id:itemId,
    pack_unit_id:packUnitId,
    supplier_sku:String(body.supplierSku||"").trim().slice(0,120),
    supplier_item_name:String(body.supplierItemName||"").trim().slice(0,180),
    unit_price:price,
    currency,
    minimum_order_quantity:minimum,
    order_multiple:multiple,
    active:true,
    updated_by:ctx.subjectId,
    updated_at:now()
  };
  if(body.supplierItemId){
    const{data,error}=await db.from("inventory_supplier_items").update(row).eq("organization_id",ctx.organizationId).eq("id",asUuid(body.supplierItemId,"supplier_item")).select().single();
    if(error)dbFail(error,"update_supplier_item",requestId);
    return data;
  }
  row.created_by=ctx.subjectId;
  const{data,error}=await db.from("inventory_supplier_items").insert(row).select().single();
  if(error){
    if(String(error.code)==="23505")fail(409,"supplier_item_duplicate","Artikel ist diesem Lieferanten bereits zugeordnet.");
    dbFail(error,"create_supplier_item",requestId);
  }
  return data;
}

export async function getOrderingProfile(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const[{data:profile,error},{data:loc,error:le},{data:org,error:oe}]=await Promise.all([
    db.from("inventory_ordering_profiles").select("*").eq("organization_id",ctx.organizationId).eq("location_id",locationId).maybeSingle(),
    db.from("locations").select("name,address,city,country,payload").eq("organization_id",ctx.organizationId).eq("id",locationId).single(),
    db.from("organizations").select("name,billing_email").eq("id",ctx.organizationId).single()
  ]);
  if(error||le||oe)dbFail(error||le||oe,"ordering_profile",requestId);
  return{profile:profile||{location_id:locationId,cafe_name:loc?.name||"",legal_name:org?.name||"",address:loc?.address||"",postal_code:String(loc?.payload?.postalCode||""),city:loc?.city||"",phone:String(loc?.payload?.phone||""),ordering_email:org?.billing_email||"",reply_to_email:org?.billing_email||"",whatsapp_number:String(loc?.payload?.whatsapp||""),customer_number:"",vat_id:"",signature:""}};
}

export async function saveOrderingProfile(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const row={organization_id:ctx.organizationId,location_id:locationId,cafe_name:String(body.cafeName||"").trim().slice(0,160),legal_name:String(body.legalName||"").trim().slice(0,160),address:String(body.address||"").trim().slice(0,240),postal_code:String(body.postalCode||"").trim().slice(0,20),city:String(body.city||"").trim().slice(0,120),phone:String(body.phone||"").trim().slice(0,50),ordering_email:email(body.orderingEmail),reply_to_email:email(body.replyToEmail),whatsapp_number:String(body.whatsappNumber||"").trim().slice(0,50),customer_number:String(body.customerNumber||"").trim().slice(0,80),vat_id:String(body.vatId||"").trim().slice(0,80),signature:String(body.signature||"").trim().slice(0,1000),updated_by:ctx.subjectId,updated_at:now()};
  const{data,error}=await db.from("inventory_ordering_profiles").upsert(row,{onConflict:"organization_id,location_id"}).select().single();
  if(error)dbFail(error,"save_ordering_profile",requestId);
  return data;
}
