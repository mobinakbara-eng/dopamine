import {db,dbFail,asUuid,requirePermission,type InventoryContext} from "./lib.ts";

const DAY=86_400_000;
function num(value:any){const n=Number(value);return Number.isFinite(n)?n:0}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value))}
function round(value:number,digits=1){const factor=10**digits;return Math.round(value*factor)/factor}
function mean(values:number[]){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null}
function standardDeviation(values:number[]){if(values.length<2)return null;const avg=mean(values)!;return Math.sqrt(values.reduce((sum,value)=>sum+(value-avg)**2,0)/values.length)}
function suggestedPackCount(requiredBase:number,packBase:number,minimum:number,multiple:number){
  if(!(requiredBase>0)||!(packBase>0))return 0;
  const raw=requiredBase/packBase,rounded=Math.ceil((Math.max(raw,minimum)/multiple)-1e-10)*multiple;
  return Math.round(rounded*1e6)/1e6;
}
function firstReceiptMap(receipts:any[]){
  const map=new Map<string,string>();
  for(const row of receipts||[]){
    if(!row.purchase_order_id||!row.received_at)continue;
    const key=String(row.purchase_order_id),existing=map.get(key);
    if(!existing||Date.parse(row.received_at)<Date.parse(existing))map.set(key,row.received_at);
  }
  return map;
}
function deliveryDate(order:any,receiptMap:Map<string,string>){return receiptMap.get(String(order.id))||order.received_at||null}

export async function listSupplierIntelligence(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const itemId=body.itemId?asUuid(body.itemId,"item"):null;
  const requiredBaseQuantity=Math.max(0,num(body.requiredBaseQuantity));
  const since=new Date(Date.now()-180*DAY).toISOString();

  const[
    {data:suppliers,error:se},
    {data:orders,error:oe},
    {data:receipts,error:re},
    {data:exceptions,error:ee}
  ]=await Promise.all([
    db.from("inventory_suppliers").select("id,name,contact,active,version,updated_at").eq("organization_id",ctx.organizationId).eq("active",true).order("name").limit(250),
    db.from("inventory_purchase_orders").select("id,supplier_id,status,expected_on,created_at,submitted_at,sent_at,received_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).gte("created_at",since).order("created_at",{ascending:false}).limit(800),
    db.from("inventory_goods_receipts").select("id,purchase_order_id,received_at,status").eq("organization_id",ctx.organizationId).eq("location_id",locationId).gte("received_at",since).order("received_at",{ascending:true}).limit(1600),
    db.from("inventory_receipt_exceptions").select("purchase_order_id,exception_type,base_quantity,created_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).gte("created_at",since).limit(4000)
  ]);
  if(se||oe||re||ee)dbFail(se||oe||re||ee,"supplier_intelligence",requestId);

  const orderIds=(orders||[]).map((row:any)=>row.id);
  const{data:lines,error:le}=orderIds.length
    ?await db.from("inventory_purchase_order_lines").select("purchase_order_id,item_id,ordered_quantity,received_quantity").eq("organization_id",ctx.organizationId).in("purchase_order_id",orderIds).limit(8000)
    :{data:[],error:null};
  if(le)dbFail(le,"supplier_intelligence_lines",requestId);

  const receiptMap=firstReceiptMap(receipts||[]),linesByOrder=new Map<string,any[]>(),exceptionsByOrder=new Map<string,any[]>();
  for(const line of lines||[]){const key=String(line.purchase_order_id);if(!linesByOrder.has(key))linesByOrder.set(key,[]);linesByOrder.get(key)!.push(line)}
  for(const row of exceptions||[]){if(!row.purchase_order_id)continue;const key=String(row.purchase_order_id);if(!exceptionsByOrder.has(key))exceptionsByOrder.set(key,[]);exceptionsByOrder.get(key)!.push(row)}

  const performance=(suppliers||[]).map((supplier:any)=>{
    const supplierOrders=(orders||[]).filter((order:any)=>String(order.supplier_id)===String(supplier.id));
    const deliveryOrders=supplierOrders.filter((order:any)=>deliveryDate(order,receiptMap)||exceptionsByOrder.has(String(order.id)));
    const expectedSamples=deliveryOrders.filter((order:any)=>order.expected_on&&deliveryDate(order,receiptMap));
    const onTimeCount=expectedSamples.filter((order:any)=>String(deliveryDate(order,receiptMap)).slice(0,10)<=String(order.expected_on)).length;
    const onTimeRate=expectedSamples.length?onTimeCount/expectedSamples.length:null;

    const leadSamples=deliveryOrders.map((order:any)=>{
      const received=deliveryDate(order,receiptMap),started=order.sent_at||order.submitted_at||order.created_at;
      if(!received||!started)return null;
      const days=(Date.parse(received)-Date.parse(started))/DAY;
      return Number.isFinite(days)&&days>=0&&days<180?days:null;
    }).filter((value:any)=>value!=null) as number[];
    const avgLeadDays=mean(leadSamples),leadDeviation=standardDeviation(leadSamples);

    let goodBaseQuantity=0,exceptionBaseQuantity=0;
    for(const order of supplierOrders){
      for(const line of linesByOrder.get(String(order.id))||[])goodBaseQuantity+=Math.max(0,num(line.received_quantity));
      for(const ex of exceptionsByOrder.get(String(order.id))||[])exceptionBaseQuantity+=Math.max(0,num(ex.base_quantity));
    }
    const deliveryAccuracy=goodBaseQuantity+exceptionBaseQuantity>0?goodBaseQuantity/(goodBaseQuantity+exceptionBaseQuantity):null;
    const evidenceCount=deliveryOrders.length;
    const leadStability=avgLeadDays!=null&&leadDeviation!=null&&avgLeadDays>0?1-clamp(leadDeviation/avgLeadDays,0,1):0.7;
    const reliabilityScore=evidenceCount>=3
      ?Math.round(clamp((onTimeRate??0.75)*50+(deliveryAccuracy??0.9)*40+leadStability*10,0,100))
      :null;

    return{
      id:String(supplier.id),name:String(supplier.name||"Lieferant"),contact:supplier.contact||{},version:Number(supplier.version||1),
      evidenceCount,onTimeSampleCount:expectedSamples.length,onTimeRate:onTimeRate==null?null:round(onTimeRate*100,0),
      deliveryAccuracy:deliveryAccuracy==null?null:round(deliveryAccuracy*100,0),
      avgLeadDays:avgLeadDays==null?null:round(avgLeadDays,1),leadTimeSampleCount:leadSamples.length,
      exceptionBaseQuantity:round(exceptionBaseQuantity,3),goodBaseQuantity:round(goodBaseQuantity,3),
      reliabilityScore,reliabilityConfidence:evidenceCount>=5?"established":evidenceCount>=3?"early":"learning",
      updatedAt:supplier.updated_at||null
    };
  });

  if(!itemId)return{locationId,windowDays:180,suppliers:performance,decision:null};

  const{data:supplierItems,error:sie}=await db.from("inventory_supplier_items")
    .select("id,supplier_id,item_id,pack_unit_id,supplier_sku,supplier_item_name,unit_price,currency,minimum_order_quantity,order_multiple,active")
    .eq("organization_id",ctx.organizationId).eq("item_id",itemId).eq("active",true).limit(250);
  if(sie)dbFail(sie,"supplier_decision_items",requestId);
  const packIds=[...new Set((supplierItems||[]).map((row:any)=>row.pack_unit_id).filter(Boolean))];
  const{data:packs,error:pe}=packIds.length
    ?await db.from("inventory_pack_units").select("id,label,code,base_quantity,active").eq("organization_id",ctx.organizationId).in("id",packIds)
    :{data:[],error:null};
  if(pe)dbFail(pe,"supplier_decision_packs",requestId);

  const performanceMap=new Map(performance.map((row:any)=>[String(row.id),row])),packMap=new Map((packs||[]).map((row:any)=>[String(row.id),row]));
  const rawCandidates=(supplierItems||[]).map((mapping:any)=>{
    const supplier:any=performanceMap.get(String(mapping.supplier_id));
    const pack:any=packMap.get(String(mapping.pack_unit_id));
    if(!supplier||!pack||!(num(pack.base_quantity)>0))return null;
    const packBase=num(pack.base_quantity),minimum=Math.max(0.000001,num(mapping.minimum_order_quantity)||1),multiple=Math.max(0.000001,num(mapping.order_multiple)||1),price=mapping.unit_price==null?null:num(mapping.unit_price),packCount=suggestedPackCount(requiredBaseQuantity,packBase,minimum,multiple);
    return{
      supplierId:supplier.id,supplierName:supplier.name,contact:supplier.contact,supplierItemId:String(mapping.id),supplierSku:String(mapping.supplier_sku||""),supplierItemName:String(mapping.supplier_item_name||""),
      pack:{id:String(pack.id),label:String(pack.label||pack.code||"Packung"),baseQuantity:packBase},
      currency:String(mapping.currency||"EUR").toUpperCase(),unitPrice:price,baseUnitPrice:price==null?null:price/packBase,
      minimumOrderQuantity:minimum,orderMultiple:multiple,requiredBaseQuantity,suggestedPackCount:packCount,suggestedBaseQuantity:packCount*packBase,
      estimatedValue:price==null||packCount<=0?null:price*packCount,
      performance:supplier
    };
  }).filter(Boolean) as any[];

  const currencies=[...new Set(rawCandidates.filter(c=>c.baseUnitPrice!=null).map(c=>c.currency))],priceComparable=currencies.length<=1;
  const knownPrices=rawCandidates.map(c=>c.baseUnitPrice).filter((value:any)=>value!=null&&value>0) as number[];
  const minPrice=priceComparable&&knownPrices.length?Math.min(...knownPrices):null;
  const knownLeads=rawCandidates.map(c=>c.performance.avgLeadDays).filter((value:any)=>value!=null&&value>=0) as number[];
  const minLead=knownLeads.length?Math.min(...knownLeads):null;

  const candidates=rawCandidates.map(candidate=>{
    const priceScore=minPrice!=null&&candidate.baseUnitPrice!=null&&candidate.baseUnitPrice>0?clamp(minPrice/candidate.baseUnitPrice*100,0,100):65;
    const reliabilityScore=candidate.performance.reliabilityScore==null?70:candidate.performance.reliabilityScore;
    const leadScore=minLead!=null&&candidate.performance.avgLeadDays!=null?clamp((minLead+0.5)/(candidate.performance.avgLeadDays+0.5)*100,0,100):70;
    const decisionScore=Math.round(priceScore*0.5+reliabilityScore*0.35+leadScore*0.15);
    const pricePremiumPct=minPrice!=null&&candidate.baseUnitPrice!=null?round((candidate.baseUnitPrice/minPrice-1)*100,1):null;
    const reasons:string[]=[];
    if(minPrice!=null&&candidate.baseUnitPrice!=null&&Math.abs(candidate.baseUnitPrice-minPrice)<1e-9)reasons.push("Günstigster vergleichbarer Preis pro Basiseinheit");
    else if(pricePremiumPct!=null)reasons.push(`${pricePremiumPct}% über dem günstigsten vergleichbaren Preis`);
    else reasons.push(priceComparable?"Noch kein belastbarer Preisvergleich":"Währungen sind nicht direkt vergleichbar");
    if(candidate.performance.reliabilityScore!=null)reasons.push(`Zuverlässigkeit ${candidate.performance.reliabilityScore}/100 aus ${candidate.performance.evidenceCount} Lieferungen`);
    else reasons.push(`Zuverlässigkeit lernt noch · ${candidate.performance.evidenceCount} Lieferung${candidate.performance.evidenceCount===1?"":"en"}`);
    if(candidate.performance.avgLeadDays!=null)reasons.push(`Ø Lieferzeit ${candidate.performance.avgLeadDays} Tage`);
    if(requiredBaseQuantity>0)reasons.push(`Auf ${candidate.suggestedPackCount} ${candidate.pack.label} gerundet · ${round(candidate.suggestedBaseQuantity,3)} Basiseinheiten`);
    return{...candidate,priceScore:Math.round(priceScore),leadScore:Math.round(leadScore),decisionScore,pricePremiumPct,reasons};
  }).sort((a,b)=>b.decisionScore-a.decisionScore||(a.estimatedValue??Number.POSITIVE_INFINITY)-(b.estimatedValue??Number.POSITIVE_INFINITY)||a.supplierName.localeCompare(b.supplierName,"de"));

  return{
    locationId,windowDays:180,suppliers:performance,
    decision:{
      itemId,requiredBaseQuantity,priceComparable,
      policy:{priceWeight:50,reliabilityWeight:35,leadTimeWeight:15,learningReliabilityNeutralScore:70},
      recommendedSupplierId:candidates[0]?.supplierId||null,
      candidates:candidates.map((candidate,index)=>({...candidate,recommended:index===0}))
    }
  };
}
