import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const api=read('supabase/functions/aora-v8-inventory-next/supplier-intelligence.ts');
const router=read('supabase/functions/aora-v8-inventory-next/router-v3.ts');
const ui=read('app/modules/inventory-orders-v2.js');
const css=read('app/inventory.css');

assert(api.includes('await requirePermission(ctx,locationId,"procurement",requestId)'), 'supplier intelligence must remain procurement-scoped');
assert(api.includes('const since=new Date(Date.now()-180*DAY)'), 'supplier evidence window must be bounded');
assert(api.includes('const reliabilityScore=evidenceCount>=3'), 'Aora must not invent reliability before three real deliveries');
assert(api.includes('goodBaseQuantity/(goodBaseQuantity+exceptionBaseQuantity)'), 'delivery accuracy must include damaged/missing exception evidence');
assert(api.includes('const onTimeRate=expectedSamples.length?onTimeCount/expectedSamples.length:null'), 'on-time score must only use orders with promised and observed dates');
assert(api.includes('price/mapping')===false, 'source must not use an invalid raw mapping-price expression');
assert(api.includes('price/packBase'), 'supplier price must be normalized to base quantity');
assert(api.includes('priceComparable=currencies.length<=1'), 'different currencies must never be directly price-ranked without FX data');
assert(api.includes('priceWeight:50,reliabilityWeight:35,leadTimeWeight:15'), 'decision weights must be explicit and inspectable');
assert(api.includes('reasons:string[]=[]'), 'every supplier decision must expose human-readable reasons');
assert(api.includes('learningReliabilityNeutralScore:70'), 'insufficient reliability history must use an explicit neutral prior rather than fabricated precision');
assert(router.includes('action==="listSupplierIntelligence"'), 'router must expose supplier intelligence');
assert(router.includes('version:5'), 'inventory health version must advance with supplier decision API');
assert(ui.includes('invRequest("listSupplierIntelligence"'), 'order and supplier UX must use the decision API');
assert(ui.includes('Aora Supplier Decision'), 'focused reorder must explain that Aora is ranking suppliers');
assert(ui.includes('Preis 50 %, Lieferzuverlässigkeit 35 %, Lieferzeit 15 %'), 'manager must see the ranking weights in plain language');
assert(ui.includes('Aora empfiehlt'), 'recommended supplier must be visually explicit');
assert(ui.includes('Aora lernt'), 'sparse supplier history must be labeled as learning');
assert(ui.includes('unterschiedliche Währungen'), 'UI must explain when price comparison is intentionally disabled');
assert(css.includes('.inventory-supplier.recommended'), 'recommended supplier needs a distinct but consistent visual treatment');
assert(css.includes('.inventory-supplier-recommendation'), 'decision explanation card must be styled');

console.log('inventory supplier intelligence source gate passed');
