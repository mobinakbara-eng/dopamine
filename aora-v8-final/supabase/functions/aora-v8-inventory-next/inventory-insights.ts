import {db,dbFail,requirePermission,type InventoryContext} from "./lib.ts";

const DAY=86_400_000;
function num(value:any){const n=Number(value);return Number.isFinite(n)?n:0}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value))}

export async function listInventoryInsights(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"view",requestId);
  const nowMs=Date.now(),since30=new Date(nowMs-30*DAY).toISOString(),since90=new Date(nowMs-90*DAY).toISOString();

  const[{data:balances,error:be},{data:movements,error:me},{data:counts,error:ce},{data:exceptions,error:ee}]=await Promise.all([
    db.from("inventory_balances").select("item_id,on_hand,reserved,in_transit_in,updated_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).limit(500),
    db.from("inventory_movements").select("item_id,movement_type,quantity_delta,reason_code,reference_type,occurred_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).gte("occurred_at",since30).order("occurred_at",{ascending:true}).limit(5000),
    db.from("inventory_counts").select("id,posted_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).eq("status","posted").gte("posted_at",since90).order("posted_at",{ascending:false}).limit(150),
    db.from("inventory_receipt_exceptions").select("item_id,exception_type,base_quantity,created_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).gte("created_at",since30).limit(2000)
  ]);
  if(be||me||ce||ee)dbFail(be||me||ce||ee,"inventory_insights",requestId);

  const itemIds=[...new Set((balances||[]).map((row:any)=>String(row.item_id)))];
  if(!itemIds.length)return{locationId,summary:{runoutRiskCount:0,lowConfidenceCount:0,unexplainedVariance30d:0,waste30d:0,receiptException30d:0},items:[]};
  const countIds=(counts||[]).map((row:any)=>row.id);
  const[{data:items,error:ie},{data:countLines,error:cle},{data:stockUnits,error:sue}]=await Promise.all([
    db.from("inventory_items").select("id,name,sku,base_uom,category,consumption_mode").eq("organization_id",ctx.organizationId).in("id",itemIds),
    countIds.length?db.from("inventory_count_lines").select("count_id,item_id,variance,baseline_captured_at,updated_at").eq("organization_id",ctx.organizationId).in("count_id",countIds).in("item_id",itemIds).limit(5000):Promise.resolve({data:[],error:null}),
    db.from("inventory_stock_units").select("item_id,status,remaining_quantity,created_at").eq("organization_id",ctx.organizationId).eq("location_id",locationId).in("item_id",itemIds).gte("created_at",since90).limit(5000)
  ]);
  if(ie||cle||sue)dbFail(ie||cle||sue,"inventory_insights_context",requestId);

  const itemMap=new Map((items||[]).map((row:any)=>[String(row.id),row]));
  const movementMap=new Map<string,any[]>(),countMap=new Map<string,any[]>(),unitMap=new Map<string,any[]>(),exceptionMap=new Map<string,any[]>();
  for(const row of movements||[]){const key=String(row.item_id);if(!movementMap.has(key))movementMap.set(key,[]);movementMap.get(key)!.push(row)}
  for(const row of countLines||[]){const key=String(row.item_id);if(!countMap.has(key))countMap.set(key,[]);countMap.get(key)!.push(row)}
  for(const row of stockUnits||[]){const key=String(row.item_id);if(!unitMap.has(key))unitMap.set(key,[]);unitMap.get(key)!.push(row)}
  for(const row of exceptions||[]){const key=String(row.item_id);if(!exceptionMap.has(key))exceptionMap.set(key,[]);exceptionMap.get(key)!.push(row)}

  const result=(balances||[]).map((balance:any)=>{
    const itemId=String(balance.item_id),item:any=itemMap.get(itemId)||{},moves=movementMap.get(itemId)||[],countRows=countMap.get(itemId)||[],units=unitMap.get(itemId)||[],exceptionRows=exceptionMap.get(itemId)||[];

    // Demand forecast intentionally uses only real consumption. Waste is kept as
    // a separate operational-loss signal so a bad waste day cannot make Aora
    // pretend customer demand is higher than it really was.
    const depletions=moves.filter((m:any)=>m.movement_type==="consumption"&&num(m.quantity_delta)<0);
    const depletion30d=depletions.reduce((sum:number,m:any)=>sum+Math.abs(num(m.quantity_delta)),0);
    const waste30d=moves.filter((m:any)=>m.movement_type==="waste"&&num(m.quantity_delta)<0).reduce((sum:number,m:any)=>sum+Math.abs(num(m.quantity_delta)),0);
    const unexplainedVariance30d=moves.filter((m:any)=>m.movement_type==="adjustment_out"&&(m.reason_code==="inventory_count"||m.reference_type==="inventory_count")).reduce((sum:number,m:any)=>sum+Math.abs(num(m.quantity_delta)),0);
    const manualAdjustments=moves.filter((m:any)=>["adjustment_in","adjustment_out"].includes(String(m.movement_type))&&m.reason_code!=="inventory_count"&&m.reference_type!=="inventory_count").length;
    const earliest=depletions.length?new Date(depletions[0].occurred_at).getTime():null;
    const observedDays=earliest==null?0:clamp(Math.ceil((nowMs-earliest)/DAY)+1,7,30);
    const avgDailyDepletion=depletions.length>=3&&observedDays>0?depletion30d/observedDays:0;
    const available=Math.max(0,num(balance.on_hand)-num(balance.reserved));
    const daysToEmpty=avgDailyDepletion>0?Math.round((available/avgDailyDepletion)*10)/10:null;
    const forecastSample=depletions.length;
    const forecastConfidence=forecastSample<3?"insufficient":forecastSample<8?"early":"established";

    const latestCountAt=countRows.map((r:any)=>r.baseline_captured_at||r.updated_at).filter(Boolean).map((v:any)=>new Date(v).getTime()).filter(Number.isFinite).sort((a:number,b:number)=>b-a)[0]||null;
    const daysSinceCount=latestCountAt==null?null:Math.max(0,(nowMs-latestCountAt)/DAY);
    const recencyPenalty=daysSinceCount==null?35:Math.min(35,daysSinceCount*1.2);
    const adjustmentPenalty=Math.min(25,manualAdjustments*5);

    // Confidence is deliberately based only on evidence that applies to every
    // item: physical-count recency and manual corrections. QR coverage can be
    // partial by configuration, so it is exposed as an informational signal but
    // never used to punish the stock-confidence score.
    const confidenceScore=Math.round(clamp(100-recencyPenalty-adjustmentPenalty,0,100));
    const confidenceLabel=confidenceScore>=80?"high":confidenceScore>=60?"medium":"low";
    const qrRemaining=units.filter((u:any)=>u.status==="available").reduce((sum:number,u:any)=>sum+num(u.remaining_quantity),0);
    const hasQrHistory=units.length>0;
    const qrCoverageSignal=hasQrHistory?(available>0?Math.round(clamp((qrRemaining/available)*100,0,100)):qrRemaining>0?100:0):null;

    const receiptException30d=exceptionRows.reduce((sum:number,row:any)=>sum+num(row.base_quantity),0);
    const damaged30d=exceptionRows.filter((row:any)=>row.exception_type==="damaged").reduce((sum:number,row:any)=>sum+num(row.base_quantity),0);
    const missing30d=exceptionRows.filter((row:any)=>row.exception_type==="missing").reduce((sum:number,row:any)=>sum+num(row.base_quantity),0);

    return{
      itemId,
      item:{id:itemId,name:item.name||"Artikel",sku:item.sku||"",base_uom:item.base_uom||"",category:item.category||"",consumptionMode:item.consumption_mode||"whole_pack"},
      onHand:num(balance.on_hand),reserved:num(balance.reserved),inTransit:num(balance.in_transit_in),
      avgDailyDepletion:Math.round(avgDailyDepletion*1000)/1000,daysToEmpty,forecastSample,forecastConfidence,
      confidenceScore,confidenceLabel,lastCountAt:latestCountAt?new Date(latestCountAt).toISOString():null,manualAdjustmentCount30d:manualAdjustments,qrTrackedQuantity:qrRemaining,qrCoverageSignal,
      unexplainedVariance30d,waste30d,receiptException30d,damaged30d,missing30d,
      runoutRisk:daysToEmpty==null?"unknown":daysToEmpty<=2?"critical":daysToEmpty<=5?"warning":"normal"
    };
  });

  result.sort((a:any,b:any)=>{
    const ar=a.daysToEmpty==null?99999:a.daysToEmpty,br=b.daysToEmpty==null?99999:b.daysToEmpty;
    return ar-br||a.confidenceScore-b.confidenceScore||b.unexplainedVariance30d-a.unexplainedVariance30d;
  });
  return{
    locationId,
    summary:{
      runoutRiskCount:result.filter((x:any)=>["critical","warning"].includes(x.runoutRisk)).length,
      lowConfidenceCount:result.filter((x:any)=>x.confidenceScore<60).length,
      unexplainedVariance30d:result.reduce((sum:number,x:any)=>sum+x.unexplainedVariance30d,0),
      waste30d:result.reduce((sum:number,x:any)=>sum+x.waste30d,0),
      receiptException30d:result.reduce((sum:number,x:any)=>sum+x.receiptException30d,0)
    },
    items:result
  };
}
