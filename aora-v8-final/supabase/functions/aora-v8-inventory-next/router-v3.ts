import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {ApiError,MAX_BODY_BYTES,allowedOrigin,cors,json,fail,sessionContext,requireFeature} from "./lib.ts";
import {availability,overview,listStock,listMovements} from "./inventory-read-core.ts";
import {listTransfers,listTransferSuggestions,listPurchaseOrders,listPackUnits,listPrintJobs,listEmployeeAccess,listReplenishment} from "./inventory-read-orders.ts";
import {createItem,recordMovement,createTransfer,createAutopilotTransfer,changeTransfer,createPackUnit} from "./inventory-write-core.ts";
import {receiveQrUnits,preparePrintJob,confirmPrintJob,inspectQrUnit,inspectQrShortCode,issueQrUnit,setItemConsumptionPolicy,setEmployeeAccess,getPrintProfile,savePrintProfile,printTestLabel} from "./inventory-write-qr.ts";
import {listManagerAccess,setManagerAccess,listSuppliers,upsertSupplier,listSupplierItems,upsertSupplierItem,getOrderingProfile,saveOrderingProfile} from "./procurement-admin.ts";
import {listSupplierIntelligence} from "./supplier-intelligence.ts";
import {createPurchaseOrder,sendPurchaseOrder,confirmManualPurchaseOrderSent,listPurchaseOrderDeliveries} from "./procurement-order.ts";
import {startInventoryCount,getInventoryCount,setInventoryCountLine,postInventoryCount,receivePurchaseOrderDelivery,receivePurchaseOrderLine,issueQrShortCode} from "./inventory-count-receive.ts";
import {listInventoryInsights} from "./inventory-insights.ts";

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
    if(action==="health")return json({ok:true,service:"aora-v8-inventory-next",version:5,emailProviderConfigured:Boolean((Deno.env.get("RESEND_API_KEY")||Deno.env.get("AORA_ORDER_EMAIL_API_KEY"))&&Deno.env.get("AORA_ORDER_FROM_EMAIL")),serverTime:new Date().toISOString()},200,origin,requestId);

    const sessionToken=String(body.sessionToken||body.token||"");
    const ctx=await sessionContext(sessionToken,requestId);
    if(action==="issueQrUnit"){
      const qrToken=String(body.qrToken||body.token||"");
      if(!qrToken)fail(400,"qr_invalid","Der QR-Code ist ungültig.");
      body={...body,token:qrToken};
    }

    if(action==="availability")return json(await availability(ctx,body,requestId),200,origin,requestId);
    const employeeActions=["inspectQrUnit","inspectQrShortCode","issueQrUnit","issueQrShortCode"];
    if(ctx.accessRole==="employee"&&!employeeActions.includes(action))fail(403,"employee_action_forbidden","Mitarbeiter dürfen ausschließlich freigegebene QR-Einheiten scannen.");
    const locationId=body.locationId==null?"":String(body.locationId);
    if(locationId)await requireFeature(ctx,"inventory_v1",locationId,requestId);
    let data:any;
    if(action==="overview")data=await overview(ctx,body,requestId);
    else if(action==="listStock")data=await listStock(ctx,body,requestId);
    else if(action==="listMovements")data=await listMovements(ctx,body,requestId);
    else if(action==="listInventoryInsights")data=await listInventoryInsights(ctx,body,requestId);
    else if(action==="createItem")data=await createItem(ctx,body,requestId);
    else if(action==="recordReceipt")data=await recordMovement(ctx,body,"receipt",requestId);
    else if(action==="recordConsumption")data=await recordMovement(ctx,body,"consumption",requestId);
    else if(action==="recordWaste")data=await recordMovement(ctx,body,"waste",requestId);
    else if(action==="adjustStock")data=await recordMovement(ctx,body,Number(body.quantity)>=0?"adjustment_in":"adjustment_out",requestId);
    else if(action==="listTransfers")data=await listTransfers(ctx,body,requestId);
    else if(action==="listTransferSuggestions"){if(locationId)await requireFeature(ctx,"replenishment_suggestions",locationId,requestId);data=await listTransferSuggestions(ctx,body,requestId)}
    else if(action==="createTransfer")data=await createTransfer(ctx,body,requestId);
    else if(action==="createAutopilotTransfer"){
      const destinationLocationId=String(body.destinationLocationId||"");
      await requireFeature(ctx,"inventory_v1",destinationLocationId,requestId);
      await requireFeature(ctx,"replenishment_suggestions",destinationLocationId,requestId);
      data=await createAutopilotTransfer(ctx,body,requestId);
    }
    else if(action==="dispatchTransfer")data=await changeTransfer(ctx,body,"dispatch",requestId);
    else if(action==="receiveTransfer")data=await changeTransfer(ctx,body,"receive",requestId);
    else if(action==="cancelTransfer")data=await changeTransfer(ctx,body,"cancel",requestId);
    else if(action==="listPurchaseOrders")data=await listPurchaseOrders(ctx,body,requestId);
    else if(action==="listPackUnits")data=await listPackUnits(ctx,body,requestId);
    else if(action==="createPackUnit")data=await createPackUnit(ctx,body,requestId);
    else if(action==="receiveQrUnits")data=await receiveQrUnits(ctx,body,requestId);
    else if(action==="listPrintJobs")data=await listPrintJobs(ctx,body,requestId);
    else if(action==="preparePrintJob")data=await preparePrintJob(ctx,body,requestId);
    else if(action==="confirmPrintJob")data=await confirmPrintJob(ctx,body,requestId);
    else if(action==="inspectQrUnit")data=await inspectQrUnit(ctx,body,requestId);
    else if(action==="inspectQrShortCode")data=await inspectQrShortCode(ctx,body,requestId);
    else if(action==="issueQrUnit")data=await issueQrUnit(ctx,body,requestId);
    else if(action==="issueQrShortCode")data=await issueQrShortCode(ctx,body,requestId);
    else if(action==="setItemConsumptionPolicy")data=await setItemConsumptionPolicy(ctx,body,requestId);
    else if(action==="listEmployeeAccess")data=await listEmployeeAccess(ctx,body,requestId);
    else if(action==="setEmployeeAccess")data=await setEmployeeAccess(ctx,body,requestId);
    else if(action==="getPrintProfile")data=await getPrintProfile(ctx,body,requestId);
    else if(action==="savePrintProfile")data=await savePrintProfile(ctx,body,requestId);
    else if(action==="printTestLabel")data=await printTestLabel(ctx,body,requestId);
    else if(action==="listReplenishment"){if(locationId)await requireFeature(ctx,"replenishment_suggestions",locationId,requestId);data=await listReplenishment(ctx,body,requestId)}
    else if(action==="listManagerAccess")data=await listManagerAccess(ctx,body,requestId);
    else if(action==="setManagerFullAccess")data=await setManagerAccess(ctx,body,requestId);
    else if(action==="listSuppliers")data=await listSuppliers(ctx,body,requestId);
    else if(action==="listSupplierIntelligence")data=await listSupplierIntelligence(ctx,body,requestId);
    else if(action==="upsertSupplier")data=await upsertSupplier(ctx,body,requestId);
    else if(action==="listSupplierItems")data=await listSupplierItems(ctx,body,requestId);
    else if(action==="upsertSupplierItem")data=await upsertSupplierItem(ctx,body,requestId);
    else if(action==="getOrderingProfile")data=await getOrderingProfile(ctx,body,requestId);
    else if(action==="saveOrderingProfile")data=await saveOrderingProfile(ctx,body,requestId);
    else if(action==="createPurchaseOrder")data=await createPurchaseOrder(ctx,body,requestId);
    else if(action==="sendPurchaseOrder")data=await sendPurchaseOrder(ctx,body,requestId);
    else if(action==="confirmManualPurchaseOrderSent")data=await confirmManualPurchaseOrderSent(ctx,body,requestId);
    else if(action==="listPurchaseOrderDeliveries")data=await listPurchaseOrderDeliveries(ctx,body,requestId);
    else if(action==="startInventoryCount")data=await startInventoryCount(ctx,body,requestId);
    else if(action==="getInventoryCount")data=await getInventoryCount(ctx,body,requestId);
    else if(action==="setInventoryCountLine")data=await setInventoryCountLine(ctx,body,requestId);
    else if(action==="postInventoryCount")data=await postInventoryCount(ctx,body,requestId);
    else if(action==="receivePurchaseOrderDelivery")data=await receivePurchaseOrderDelivery(ctx,body,requestId);
    else if(action==="receivePurchaseOrderLine")data=await receivePurchaseOrderLine(ctx,body,requestId);
    else fail(400,"unknown_action","Unbekannte Aktion.");
    return json(data,200,origin,requestId);
  }catch(error){
    const e=error instanceof ApiError?error:new ApiError(500,"internal_error","Die Aktion konnte nicht abgeschlossen werden.");
    console.warn("aora-inventory-rejected",{requestId,status:e.status,code:e.code,message:e.message});
    return json({error:e.message,code:e.code,requestId},e.status,origin,requestId);
  }
});
