import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const migration=read('supabase/migrations/20260819145500_inventory_expired_waste_sweep.sql');
const api=read('supabase/functions/aora-v8-inventory-next/inventory-expiry-actions.ts');
const router=read('supabase/functions/aora-v8-inventory-next/router-v3.ts');
const ui=read('app/modules/inventory-expiry-sweep.js');
const index=read('app/index.html');
const css=read('app/inventory-expiry-sweep.css');

// Postgres is the final authority for destructive expiry write-off.
assert(migration.includes('aora_inventory_waste_expired_stock_unit'), 'database must expose dedicated expired-stock waste RPC');
assert(migration.includes('from public.inventory_movements')&&migration.includes('idempotency_key=p_idempotency_key'), 'RPC must replay an already committed operation by idempotency key');
assert(migration.includes('from public.inventory_stock_units')&&migration.includes('for update;'), 'stock unit must be locked before expiry write-off');
assert(migration.includes('from public.inventory_balances'), 'live balance must be loaded for the same item/location');
assert(migration.includes("v_unit.expires_on>=current_date"), 'database must reject non-expired stock units');
assert(migration.includes("message='inventory_not_expired'"), 'non-expired rejection must be explicit');
assert(migration.includes('v_qty:=v_unit.remaining_quantity'), 'write-off must use the full live QR remainder, not a stale client quantity');
assert(migration.includes("status='waste'"), 'expired QR unit must become waste');
assert(migration.includes("movement_type")&&migration.includes("'waste',-v_qty"), 'ledger must record a negative waste movement');
assert(migration.includes("'expired','expiry_sweep'"), 'ledger must preserve explicit expiry reason and reference type');
assert(migration.includes('stock_unit_id'), 'waste movement must remain traceable to the QR stock unit');
assert(migration.includes('set on_hand=on_hand-v_qty'), 'balance must be decremented atomically by the same QR remainder');
assert(migration.includes('aora_inventory_evaluate_replenishment'), 'expiry write-off must re-evaluate replenishment');
assert(migration.includes("'inventory.stock.expired_waste'"), 'expiry write-off must emit an outbox event');
assert(migration.includes('revoke all on function public.aora_inventory_waste_expired_stock_unit'), 'destructive expiry RPC must deny direct client execution');
assert(migration.includes('grant execute on function public.aora_inventory_waste_expired_stock_unit')&&migration.includes('to service_role'), 'destructive expiry RPC must be service-role only');

// Edge layer keeps destructive action manager-only and permission-scoped.
assert(api.includes('export async function listExpiredStockUnits'), 'manager must have a review endpoint before any write');
assert(api.includes('await requirePermission(ctx,locationId,"waste",requestId)'), 'review/write must require waste permission');
assert(api.includes('await requireFeature(ctx,"inventory_qr",locationId,requestId)'), 'expiry action must stay behind QR feature gate');
assert(api.includes('Nur Manager oder Inhaber dürfen'), 'employees must not access destructive expiry flow');
assert(api.includes('.lt("expires_on",today)'), 'review endpoint must list only already-expired units');
assert(api.includes('export async function wasteExpiredStockUnit'), 'Edge layer must expose explicit write-off action');
assert(api.includes('aora_inventory_waste_expired_stock_unit'), 'Edge write-off must call the protected database RPC');
assert(router.includes('action==="listExpiredStockUnits"'), 'router must expose expired-stock review');
assert(router.includes('action==="wasteExpiredStockUnit"'), 'router must expose expired-stock write-off');
const healthVersion=Number(router.match(/service:"aora-v8-inventory-next",version:(\d+)/)?.[1]||0);
assert(healthVersion>=7, 'inventory health version must not regress below expired-stock action API version');
assert(!router.match(/employeeActions=\[[^\]]*wasteExpiredStockUnit/), 'employee allowlist must not contain destructive expiry action');

// UI requires physical review and explicit confirmation; no automatic disposal.
assert(ui.includes('Nichts wird automatisch ausgebucht.'), 'review modal must state that Aora does not auto-write-off');
assert(ui.includes('physisch geprüft'), 'manager must explicitly attest physical review');
assert(ui.includes('input type="checkbox" name="stockUnitId"'), 'manager must be able to deselect individual units');
assert(ui.includes('name="confirmed" required'), 'final batch write-off must require explicit confirmation');
assert(ui.includes('invStableOperationKey("expired-waste"'), 'each unit write-off must keep a stable retry identity');
assert(ui.includes('invRequest("wasteExpiredStockUnit"'), 'UI must call the protected write-off action');
assert(ui.includes('runInventoryExpiryPool(selected,4'), 'batch review must use bounded concurrency');
assert(ui.includes('operation.clear();successCount++'), 'stable operation identity may only clear after server success');
assert(ui.includes('Aora bucht nichts automatisch aus.'), 'Heute action must remain review-first');
assert(ui.includes('data-inv="expired-review"'), 'Heute must expose an explicit expired-stock review action');
assert(!ui.includes('setInterval('), 'expiry write-off UI must not contain automatic background disposal');

// Module ordering preserves previous wrappers and hardened primitives.
const cyclePos=index.indexOf('modules/inventory-cycle-count.js');
const expiryPos=index.indexOf('modules/inventory-expiry-sweep.js');
const employeePos=index.indexOf('modules/inventory-employee.js');
assert(cyclePos>=0&&expiryPos>cyclePos, 'expiry insights wrapper must load after confidence cycle-count wrapper');
assert(employeePos>expiryPos, 'employee scanner may load after manager expiry module');
assert(index.includes('inventory-expiry-sweep.css'), 'expired review stylesheet must be loaded');
assert(css.includes('.inventory-expired-row'), 'expired QR review list must have dedicated layout');
assert(css.includes('.inventory-expired-confirm'), 'physical confirmation control must be visually distinct');

console.log('inventory expired waste source gate passed');
