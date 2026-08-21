import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const migration=read('supabase/migrations/20260819142500_inventory_expiry_qr_tracking.sql');
const qrApi=read('supabase/functions/aora-v8-inventory-next/inventory-write-qr.ts');
const receiptApi=read('supabase/functions/aora-v8-inventory-next/inventory-count-receive.ts');
const insightsApi=read('supabase/functions/aora-v8-inventory-next/inventory-insights.ts');
const readCore=read('supabase/functions/aora-v8-inventory-next/inventory-read-core.ts');
const readOrders=read('supabase/functions/aora-v8-inventory-next/inventory-read-orders.ts');
const router=read('supabase/functions/aora-v8-inventory-next/router-v3.ts');
const coreUi=read('app/modules/inventory-core.js');
const receivingUi=read('app/modules/inventory-orders-v2.js');
const employeeUi=read('app/modules/inventory-employee.js');
const css=read('app/inventory.css');

// Schema: expiry is opt-in per item and traceability follows receipt -> print job -> QR stock unit.
assert(migration.includes('expiry_tracking boolean not null default false'), 'expiry tracking must be explicit and opt-in');
assert(migration.includes('default_shelf_life_days integer'), 'item policy must support optional default shelf life');
assert(migration.includes('expiry_alert_days integer not null default 3'), 'item policy must support a configurable warning window');
for(const marker of ['inventory_goods_receipt_lines','inventory_label_print_jobs','inventory_stock_units']){
  const start=migration.indexOf(`alter table public.${marker}`);
  assert(start>=0, `${marker} must be extended for expiry traceability`);
  const block=migration.slice(start,start+350);
  assert(block.includes('lot_code text'), `${marker} must store lot code`);
  assert(block.includes('expires_on date'), `${marker} must store expiry date`);
}
assert(migration.includes('inventory_stock_units_expiry_idx'), 'available QR units need an expiry lookup index');

// Receiving: Aora must never invent a date if an expiry-tracked item has no configured shelf life.
assert(migration.includes("message='inventory_expiry_required'"), 'receipt must fail closed when expiry evidence is required');
assert(migration.includes("message='inventory_expiry_in_past'"), 'past expiry must be rejected from good stock');
assert(migration.includes('v_expires_on:=current_date+v_item.default_shelf_life_days'), 'configured shelf life may derive a receipt expiry');
assert(migration.includes('v_input.good_pack_count,v_good,v_lot_code,v_expires_on'), 'good receipt line must persist lot and expiry');
assert(migration.includes('v_input.item_id,v_input.pack_unit_id,v_input.good_pack_count,p_actor_id,v_lot_code,v_expires_on'), 'QR print job must inherit receipt traceability');
assert(receiptApi.includes('lot_code:String(line.lotCode||"")'), 'Edge receipt must pass lot metadata');
assert(receiptApi.includes('expires_on:line.expiresOn?String(line.expiresOn):null'), 'Edge receipt must pass expiry metadata');
assert(receiptApi.includes('expiry_required'), 'Edge receipt must map missing expiry to a friendly conflict');
assert(receiptApi.includes('expiry_in_past'), 'Edge receipt must map past expiry to a friendly conflict');

// Printing and inspection: the QR itself resolves to server-side lot/expiry context.
assert(migration.includes('v_pack.base_quantity,v_job.lot_code,v_job.expires_on'), 'prepared stock units must inherit lot/expiry from print job');
assert(migration.includes("'shortCode',v_unit.short_code,'lotCode',v_unit.lot_code,'expiresOn',v_unit.expires_on"), 'QR inspection must resolve lot and expiry server-side');
assert(qrApi.includes('select("label_count,item_id,status,lot_code,expires_on")'), 'print preparation must expose trace metadata to label rendering');
assert(qrApi.includes('lotCode:job.lot_code||null,expiresOn:job.expires_on||null'), 'printable label context must include lot/expiry');
assert(readOrders.includes('lot_code,expires_on,prepared_at'), 'print-job read model must expose trace metadata');

// Security: traceability RPCs stay server-only.
for(const signature of [
  'aora_inventory_receive_purchase_order_delivery(uuid,text,uuid,jsonb,text,text,text)',
  'aora_inventory_prepare_print_job(uuid,text,uuid,jsonb,text)',
  'aora_inventory_inspect_qr_unit(uuid,text,text)',
  'aora_inventory_inspect_qr_short_code(uuid,text,text)'
]){
  assert(migration.includes(`revoke all on function public.${signature} from public,anon,authenticated`), `${signature} must deny direct client execution`);
  assert(migration.includes(`grant execute on function public.${signature} to service_role`), `${signature} must be service-role only`);
}

// Manager policy is explicit and transparent.
assert(qrApi.includes('export async function setItemExpiryPolicy'), 'manager must be able to configure item expiry policy');
assert(qrApi.includes('defaultShelfLifeDays'), 'manager API must validate shelf-life input');
assert(qrApi.includes('expiryAlertDays'), 'manager API must validate warning days');
assert(readCore.includes('expiryTracking:Boolean(i.expiry_tracking)'), 'stock read model must expose expiry policy');
assert(router.includes('action==="setItemExpiryPolicy"'), 'router must expose expiry policy API');
const healthVersion=Number(router.match(/service:"aora-v8-inventory-next",version:(\d+)/)?.[1]||0);
assert(healthVersion>=6, 'inventory health version must not regress below MHD/FEFO API version');
assert(coreUi.includes('MHD-Regeln'), 'stock manager UI must expose MHD rules');
assert(coreUi.includes('FEFO-Empfehlungen gelten derzeit nur für QR-erfasste Einheiten'), 'manager UI must state the truthful FEFO scope');

// Operational signals are intentionally scoped to QR-tracked units only.
assert(insightsApi.includes('expirySignalScope:"qr_tracked_units"'), 'expiry insight scope must be explicit');
assert(insightsApi.includes('expiringSoonQuantity'), 'insights must expose soon-expiring quantity');
assert(insightsApi.includes('expiredQuantity'), 'insights must expose expired quantity');
assert(insightsApi.includes('nearestExpiryShortCode'), 'manager must be able to identify which QR unit to use first');
assert(insightsApi.includes('const confidenceScore=Math.round(clamp(100-recencyPenalty-adjustmentPenalty,0,100))'), 'incomplete QR coverage must not silently lower stock confidence');
assert(coreUi.includes('Nur QR-erfasste Bestandeinheiten'), 'Today UI must disclose QR-only expiry coverage');
assert(coreUi.includes('Zuerst verwenden'), 'Today UI must turn expiry evidence into an action');

// Receiving UX captures evidence at the source, not later as cleanup work.
assert(receivingUi.includes('name="expiresOn"'), 'receiving must capture MHD');
assert(receivingUi.includes('name="lotCode"'), 'receiving must capture optional lot code');
assert(receivingUi.includes('MHD ist Pflicht; Aora erfindet kein Datum.'), 'receiving must never imply a fabricated expiry');
assert(receivingUi.includes('lotCode:row.querySelector'), 'receipt payload must include lot code');
assert(receivingUi.includes('expiresOn:row.querySelector'), 'receipt payload must include expiry');
assert(receivingUi.includes('FEFO-Scan gilt erst für QR-Bestandeinheiten'), 'non-QR receipt scope must be disclosed');

// Employee FEFO is advisory. It may guide but must not silently block a legitimate scan.
assert(qrApi.includes('recommendedShortCode'), 'online inspection must return the earliest-expiring QR recommendation');
assert(qrApi.includes('scannedIsRecommended'), 'inspection must tell whether scanned QR already is FEFO choice');
assert(employeeUi.includes('First Expired, First Out'), 'employee scanner must explain FEFO');
assert(employeeUi.includes('Empfohlenes zuerst scannen'), 'scanner must provide the safe recommended path');
assert(employeeUi.includes('Dieses trotzdem verwenden'), 'scanner must preserve an explicit human override');
assert(employeeUi.includes('FEFO kann offline nicht neu bewertet werden'), 'offline limitation must be visible');
assert(employeeUi.includes('meta.fefo&&!meta.fefo.scannedIsRecommended'), 'FEFO prompt must only appear when the scanned unit is not earliest-expiring');

// Visual treatment must remain integrated with the existing inventory UI.
assert(css.includes('.inventory-expiry-badge'), 'expiry status needs compact badges');
assert(css.includes('.inventory-delivery-trace'), 'receiving trace fields need dedicated layout');
assert(css.includes('.inventory-fefo-card'), 'employee FEFO recommendation needs a clear card');
assert(css.includes('.inventory-expiry-policy-row'), 'MHD policy editor must be responsive');

// Deliberate non-scope: current aggregate transfers do not claim to relocate QR stock units.
assert(!coreUi.includes('MHD-Transfer automatisch'), 'UI must not claim expiry-aware cross-location relocation that is not implemented');

console.log('inventory expiry FEFO source gate passed');
