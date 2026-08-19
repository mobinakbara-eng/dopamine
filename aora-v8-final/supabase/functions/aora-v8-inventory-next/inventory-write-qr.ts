import QRCode from "npm:qrcode@1.5.4";
import {db,dbFail,fail,now,asUuid,idem,qrToken,shortCode,sha256Hex,requirePermission,requireFeature,type InventoryContext} from "./lib.ts";

const PRINT_PROFILES:any={
  zebra_50x30_203:{profileKey:"zebra_50x30_203",labelWidthMm:50,labelHeightMm:30,qrSizeMm:22,dpi:203,mediaType:"direct_thermal_gap",connectionMode:"system_dialog",printerModel:"Zebra ZD421d"},
  brother_62x29_300:{profileKey:"brother_62x29_300",labelWidthMm:62,labelHeightMm:29,qrSizeMm:21,dpi:300,mediaType:"direct_thermal_gap",connectionMode:"airprint",printerModel:"Brother QL-820NWBc"},
  generic_pdf_50x30:{profileKey:"generic_pdf_50x30",labelWidthMm:50,labelHeightMm:30,qrSizeMm:22,dpi:300,mediaType:"direct_thermal_gap",connectionMode:"system_dialog",printerModel:"PDF / Systemdrucker"}
};

async function enrichQrResult(ctx:InventoryContext,data:any,locationId:string,requestId:string){
  const itemId=String(data?.itemId||data?.item_id||""),packUnitId=String(data?.packUnitId||data?.pack_unit_id||"");
  const[{data:item,error:ie},{data:pack,error:pe},{data:balance,error:be}]=await Promise.all([
    itemId?db.from("inventory_items").select("id,name,sku,base_uom,consumption_mode,default_consume_quantity,expiry_tracking,default_shelf_life_days,expiry_alert_days").eq("organization_id",ctx.organizationId).eq("id",itemId).maybeSingle():Promise.resolve({data:null,error:null}),
    packUnitId?db.from("inventory_pack_units").select("id,label,code,base_quantity").eq("organization_id",ctx.organizationId).eq("id",packUnitId).maybeSingle():Promise.resolve({data:null,error:null}),
    itemId&&locationId?db.from("inventory_balances").select("on_hand").eq("organization_id",ctx.organizationId).eq("location_id",locationId).eq("item_id",itemId).maybeSingle():Promise.resolve({data:null,error:null})
  ]);
  if(ie||pe||be)dbFail(ie||pe||be,"qr_context",requestId);

  let fefo:any=null;
  if(itemId&&locationId){
    const{data:earliest,error:fe}=await db.from("inventory_stock_units")
      .select("id,short_code,expires_on,remaining_quantity")
      .eq("organization_id",ctx.organizationId)
      .eq("location_id",locationId)
      .eq("item_id",itemId)
      .eq("status","available")
      .gt("remaining_quantity",0)
      .not("expires_on","is",null)
      .order("expires_on",{ascending:true})
      .order("created_at",{ascending:true})
      .limit(1)
      .maybeSingle();
    if(fe)dbFail(fe,"qr_fefo",requestId);
    if(earliest){
      const currentId=String(data?.stockUnitId||data?.stock_unit_id||"");
      fefo={
        recommendedStockUnitId:String(earliest.id),
        recommendedShortCode:String(earliest.short_code||""),
        recommendedExpiresOn:earliest.expires_on||null,
        recommendedRemainingQuantity:Number(earliest.remaining_quantity||0),
        scannedIsRecommended:String(earliest.id)===currentId
      };
    }
  }

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
    fefo
  };
}

function qrFailure(error:any,requestId:string,scope:string){
  const m=String(error?.message||"");
  if(m.includes("already_used"))fail(409,"qr_already_used","Diese Einheit wurde bereits verwendet oder gehört zu einem anderen Standort.");
  if(m.includes("not_found"))fail(404,"qr_not_found","QR-Code wurde nicht gefunden.");
  if(m.includes("partial_quantity_required"))fail(409,"qr_partial_quantity_required","Für diese Verpackung muss eine Verbrauchsmenge angegeben werden.");
  if(m.includes("partial_quantity_invalid"))fail(409,"qr_partial_quantity_invalid","Die Menge ist größer als der Rest in dieser Verpackung oder ungültig.");
  if(m.includes("partial_not_allowed"))fail(409,"qr_partial_not_allowed","Dieser Artikel wird immer als ganze Verpackung gebucht.");
  if(m.includes("balance_invariant"))fail(409,"qr_balance_conflict","Bestand und QR-Einheit passen nicht mehr zusammen. Bitte Inventur prüfen.");
  dbFail(error,scope,requestId);
}

async function requireEmployeeQr(ctx:InventoryContext,locationId:string,requestId:string){
  await requirePermission(ctx,locationId,"consume",requestId);
  if(ctx.accessRole==="employee"){
    await requireFeature(ctx,"inventory_qr",locationId,requestId);
    await requireFeature(ctx,"inventory_employee_scan",locationId,requestId);
  }
}

export async function receiveQrUnits(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"receipt",requestId);
  await Promise.all([requireFeature(ctx,"inventory_qr",locationId,requestId),requireFeature(ctx,"inventory_printing",locationId,requestId)]);
  const count=Math.trunc(Number(body.count));
  if(!Number.isSafeInteger(count)||count<1||count>100)fail(400,"unit_count_invalid","Bitte 1 bis 100 Einheiten angeben.");
  const{data,error}=await db.rpc("aora_inventory_receive_pending_labels",{
    p_organization_id:ctx.organizationId,p_location_id:locationId,p_item_id:asUuid(body.itemId,"item"),p_pack_unit_id:asUuid(body.packUnitId,"pack_unit"),p_count:count,p_actor_id:ctx.subjectId,p_actor_role:ctx.accessRole,p_idempotency_key:idem(body.idempotencyKey),p_purchase_order_id:body.purchaseOrderId?asUuid(body.purchaseOrderId,"purchase_order"):null
  });
  if(error){
    const m=String(error.message||"");
    if(m.includes("quantity_exceeded"))fail(409,"purchase_order_quantity_exceeded","Die eingegangene Menge ist höher als die noch offene Bestellmenge.");
    if(m.includes("not_receivable"))fail(409,"purchase_order_not_receivable","Die Bestellung ist nicht mehr für einen Wareneingang offen.");
    dbFail(error,"receive_qr_units",requestId);
  }
  return data;
}

export async function inspectQrUnit(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requireEmployeeQr(ctx,locationId,requestId);
  const token=String(body.token||body.qrToken||"").trim();
  if(!/^A1\.k1\.[A-Za-z0-9_-]{24,80}$/.test(token))fail(400,"qr_invalid","Der QR-Code ist ungültig.");
  const{data,error}=await db.rpc("aora_inventory_inspect_qr_unit",{
    p_organization_id:ctx.organizationId,p_location_id:locationId,p_token_hash_hex:await sha256Hex(token)
  });
  if(error)qrFailure(error,requestId,"inspect_qr");
  return enrichQrResult(ctx,data,locationId,requestId);
}

export async function inspectQrShortCode(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requireEmployeeQr(ctx,locationId,requestId);
  const code=String(body.shortCode||"").trim();
  if(code.length<6||code.length>24)fail(400,"short_code_invalid","Kurzcode ist ungültig.");
  const{data,error}=await db.rpc("aora_inventory_inspect_qr_short_code",{
    p_organization_id:ctx.organizationId,p_location_id:locationId,p_short_code:code
  });
  if(error)qrFailure(error,requestId,"inspect_qr_short_code");
  return enrichQrResult(ctx,data,locationId,requestId);
}

export async function issueQrUnit(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requireEmployeeQr(ctx,locationId,requestId);
  const token=String(body.token||"").trim();
  if(!/^A1\.k1\.[A-Za-z0-9_-]{24,80}$/.test(token))fail(400,"qr_invalid","Der QR-Code ist ungültig.");
  const requested=body.quantity==null||body.quantity===""?null:Number(body.quantity);
  if(requested!=null&&(!Number.isFinite(requested)||requested<=0||requested>1_000_000_000))fail(400,"qr_partial_quantity_invalid","Verbrauchsmenge ist ungültig.");
  const{data,error}=await db.rpc("aora_inventory_consume_qr_unit",{
    p_organization_id:ctx.organizationId,p_location_id:locationId,p_token_hash_hex:await sha256Hex(token),p_requested_quantity:requested,p_actor_id:ctx.subjectId,p_actor_role:ctx.accessRole,p_idempotency_key:idem(body.idempotencyKey)
  });
  if(error)qrFailure(error,requestId,"issue_qr");
  return enrichQrResult(ctx,data,locationId,requestId);
}

export async function setItemConsumptionPolicy(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||""),itemId=asUuid(body.itemId,"item"),mode=String(body.consumptionMode||"");
  await requirePermission(ctx,locationId,"adjust",requestId);
  if(!["whole_pack","partial_pack"].includes(mode))fail(400,"consumption_mode_invalid","Verbrauchsart ist ungültig.");
  const rawDefault=Number(body.defaultConsumeQuantity),defaultQuantity:number|null=mode==="partial_pack"?rawDefault:null;
  if(mode==="partial_pack"&&(!Number.isFinite(rawDefault)||rawDefault<=0||rawDefault>1_000_000_000))fail(400,"default_consume_quantity_invalid","Bitte eine gültige Standardmenge angeben.");
  const{data:linked,error:le}=await db.from("inventory_item_locations").select("item_id").eq("organization_id",ctx.organizationId).eq("location_id",locationId).eq("item_id",itemId).eq("active",true).maybeSingle();
  if(le)dbFail(le,"consumption_policy_location",requestId);
  if(!linked)fail(404,"item_not_found","Artikel wurde an diesem Standort nicht gefunden.");
  const{data,error}=await db.from("inventory_items").update({consumption_mode:mode,default_consume_quantity:defaultQuantity,updated_by:ctx.subjectId,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",itemId).select("id,name,sku,base_uom,consumption_mode,default_consume_quantity").single();
  if(error)dbFail(error,"save_consumption_policy",requestId);
  return{...data,defaultConsumeQuantity:data.default_consume_quantity==null?null:Number(data.default_consume_quantity)};
}

export async function setItemExpiryPolicy(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||""),itemId=asUuid(body.itemId,"item"),enabled=Boolean(body.expiryTracking);
  await requirePermission(ctx,locationId,"adjust",requestId);
  const rawShelf=body.defaultShelfLifeDays==null||body.defaultShelfLifeDays===""?null:Number(body.defaultShelfLifeDays);
  const rawAlert=body.expiryAlertDays==null||body.expiryAlertDays===""?3:Number(body.expiryAlertDays);
  if(rawShelf!=null&&(!Number.isSafeInteger(rawShelf)||rawShelf<1||rawShelf>3650))fail(400,"shelf_life_invalid","Standard-Haltbarkeit muss zwischen 1 und 3650 Tagen liegen.");
  if(!Number.isSafeInteger(rawAlert)||rawAlert<0||rawAlert>3650)fail(400,"expiry_alert_invalid","MHD-Warnfrist muss zwischen 0 und 3650 Tagen liegen.");
  const{data:linked,error:le}=await db.from("inventory_item_locations").select("item_id").eq("organization_id",ctx.organizationId).eq("location_id",locationId).eq("item_id",itemId).eq("active",true).maybeSingle();
  if(le)dbFail(le,"expiry_policy_location",requestId);
  if(!linked)fail(404,"item_not_found","Artikel wurde an diesem Standort nicht gefunden.");
  const{data:stockPacks,error:spe}=await db.from("inventory_pack_units").select("id").eq("organization_id",ctx.organizationId).eq("item_id",itemId).eq("active",true).eq("is_stock_unit",true).limit(1);
  if(spe)dbFail(spe,"expiry_policy_stock_pack",requestId);
  const{data,error}=await db.from("inventory_items").update({expiry_tracking:enabled,default_shelf_life_days:enabled?rawShelf:null,expiry_alert_days:rawAlert,updated_by:ctx.subjectId,updated_at:now()}).eq("organization_id",ctx.organizationId).eq("id",itemId).select("id,name,sku,base_uom,expiry_tracking,default_shelf_life_days,expiry_alert_days").single();
  if(error)dbFail(error,"save_expiry_policy",requestId);
  return{
    ...data,
    expiryTracking:Boolean(data.expiry_tracking),
    defaultShelfLifeDays:data.default_shelf_life_days==null?null:Number(data.default_shelf_life_days),
    expiryAlertDays:Number(data.expiry_alert_days||0),
    qrCapable:Boolean(stockPacks?.length)
  };
}

export async function preparePrintJob(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"receipt",requestId);
  await Promise.all([requireFeature(ctx,"inventory_qr",locationId,requestId),requireFeature(ctx,"inventory_printing",locationId,requestId)]);
  const printJobId=asUuid(body.printJobId,"print_job");
  const{data:job,error:je}=await db.from("inventory_label_print_jobs").select("label_count,item_id,status,lot_code,expires_on").eq("organization_id",ctx.organizationId).eq("location_id",locationId).eq("id",printJobId).maybeSingle();
  if(je)dbFail(je,"load_print_job",requestId);
  if(!job)fail(404,"print_job_not_found","Der Druckauftrag wurde nicht gefunden.");
  if(job.status==="printed")fail(409,"print_job_already_printed","Dieser Druckauftrag wurde bereits bestätigt.");
  const count=Number(job.label_count),labels:any[]=[],units:any[]=[];
  for(let i=0;i<count;i++){
    const token=qrToken(),code=shortCode();
    labels.push({token,shortCode:code,sequence:i+1,total:count,lotCode:job.lot_code||null,expiresOn:job.expires_on||null});
    units.push({token_hash:await sha256Hex(token),short_code:code});
  }
  const{data,error}=await db.rpc("aora_inventory_prepare_print_job",{p_organization_id:ctx.organizationId,p_location_id:locationId,p_print_job_id:printJobId,p_units:units,p_actor_id:ctx.subjectId});
  if(error)dbFail(error,"prepare_print_job",requestId);
  const printable=await Promise.all(labels.map(async l=>({...l,svg:await QRCode.toString(l.token,{type:"svg",errorCorrectionLevel:"M",margin:4,width:220})})));
  return{...data,itemId:job.item_id,labels:printable,replacedPrevious:job.status==="prepared"};
}

export async function confirmPrintJob(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"receipt",requestId);
  const{data,error}=await db.rpc("aora_inventory_confirm_print_job",{p_organization_id:ctx.organizationId,p_location_id:locationId,p_print_job_id:asUuid(body.printJobId,"print_job"),p_actor_id:ctx.subjectId});
  if(error)dbFail(error,"confirm_print_job",requestId);
  return data;
}

export async function setEmployeeAccess(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"view",requestId);
  if(ctx.accessRole==="employee")fail(403,"manager_required","Nur Manager oder Inhaber dürfen Scan-Freigaben verwalten.");
  const{data,error}=await db.rpc("aora_inventory_set_employee_scan_access",{p_organization_id:ctx.organizationId,p_location_id:locationId,p_employee_id:String(body.employeeId||""),p_enabled:Boolean(body.enabled),p_actor_id:ctx.subjectId,p_actor_role:ctx.accessRole});
  if(error){
    const m=String(error.message||"");
    if(m.includes("employee_not_found"))fail(404,"employee_not_found","Mitarbeiter wurde nicht gefunden.");
    if(m.includes("location_forbidden"))fail(403,"employee_location_forbidden","Der Mitarbeiter gehört nicht zu diesem Standort.");
    dbFail(error,"set_employee_access",requestId);
  }
  return data;
}

export async function getPrintProfile(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"receipt",requestId);
  const{data,error}=await db.from("inventory_print_profiles").select("profile_key,connection_mode,printer_model,label_width_mm,label_height_mm,qr_size_mm,dpi,media_type,updated_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).maybeSingle();
  if(error)dbFail(error,"print_profile",requestId);
  if(!data)return{...PRINT_PROFILES.brother_62x29_300,locationId,persisted:false};
  return{locationId,profileKey:data.profile_key,connectionMode:data.connection_mode,printerModel:data.printer_model,labelWidthMm:Number(data.label_width_mm),labelHeightMm:Number(data.label_height_mm),qrSizeMm:Number(data.qr_size_mm),dpi:Number(data.dpi),mediaType:data.media_type,updatedAt:data.updated_at,persisted:true};
}

export async function savePrintProfile(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"receipt",requestId);
  const p=PRINT_PROFILES[String(body.profileKey||"")];
  if(!p)fail(400,"print_profile_invalid","Bitte ein unterstütztes Druckprofil auswählen.");
  const row={organization_id:ctx.organizationId,location_id:locationId,profile_key:p.profileKey,connection_mode:p.connectionMode,printer_model:p.printerModel,label_width_mm:p.labelWidthMm,label_height_mm:p.labelHeightMm,qr_size_mm:p.qrSizeMm,dpi:p.dpi,media_type:p.mediaType,updated_by:ctx.subjectId,updated_at:now()};
  const{error}=await db.from("inventory_print_profiles").upsert(row,{onConflict:"organization_id,location_id"});
  if(error)dbFail(error,"save_print_profile",requestId);
  return{...p,locationId,persisted:true,updatedAt:row.updated_at};
}

export async function printTestLabel(ctx:InventoryContext,body:any,requestId:string){
  const p=await getPrintProfile(ctx,body,requestId),value=`AORA.PRINT.TEST.${p.profileKey}`;
  return{profile:p,labels:[{test:true,shortCode:"TEST-0001",sequence:1,total:1,svg:await QRCode.toString(value,{type:"svg",errorCorrectionLevel:"M",margin:4,width:220})}]};
}
