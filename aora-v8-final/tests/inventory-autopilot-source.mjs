import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const core=read('app/modules/inventory-core.js');
const countUi=read('app/modules/inventory-access-count.js');
const ordersUi=read('app/modules/inventory-orders-v2.js');
const css=read('app/inventory.css');
const countApi=read('supabase/functions/aora-v8-inventory-next/inventory-count-receive.ts');
const procurementAdmin=read('supabase/functions/aora-v8-inventory-next/procurement-admin.ts');
const procurementOrder=read('supabase/functions/aora-v8-inventory-next/procurement-order.ts');
const baselineMigration=read('supabase/migrations/20260818194000_inventory_autopilot_count_baseline.sql');
const resumeMigration=read('supabase/migrations/20260818194100_inventory_count_resume_active_only.sql');

// Action-first UX: the first tab is not a passive stock table.
assert(core.includes('["overview","Heute"]'), 'inventory overview tab must be action-first Heute');
assert(core.includes('listReplenishment'), 'overview must consume server replenishment suggestions');
assert(core.includes('inventoryAutopilotAction'), 'overview must render autopilot action cards');
assert(core.includes('Bestellung vorbereiten'), 'low-stock action must lead directly into ordering');
assert(core.includes('inventoryMovements(d)'), 'stock view must render the ledger it fetches');
assert(core.includes('data-inv-stock-search'), 'stock view must have fast search');
assert(css.includes('.inventory-action-card'), 'autopilot action UI must be styled');

// Blind counting: never leak the system quantity into the physical-count UI.
assert(!countUi.includes('systemQuantity'), 'blind count UI must not read/render system quantity');
assert(countUi.includes('Blind zählen'), 'count UI must explain blind counting');
assert(countUi.includes('data-baseline'), 'count UI must distinguish legacy/unbaselined lines');
assert(countUi.includes('runCountPool(inputs,6,saveInput)'), 'final flush must use bounded concurrency');
assert(countUi.includes('setTimeout(()=>saveInput(input)'), 'count lines must autosave while counting');
assert(countUi.includes('Später fortsetzen'), 'count sessions must be resumable instead of destructive cancel');

// The API must atomically capture a per-line ledger baseline in Postgres.
assert(countApi.includes('aora_inventory_set_count_line'), 'count line writes must use the atomic RPC');
assert(!countApi.includes('.from("inventory_count_lines").update('), 'Edge code must not bypass the atomic count-line RPC');
assert(countApi.includes('baseline_version,baseline_captured_at'), 'count API must return baseline metadata');
assert(baselineMigration.includes('baseline_version integer'), 'migration must persist a balance version per physical count line');
assert(baselineMigration.includes('baseline_captured_at timestamptz'), 'migration must persist baseline capture time');
assert(baselineMigration.includes('aora_inventory_set_count_line'), 'migration must define the atomic line-save function');
assert(baselineMigration.includes("message='inventory_count_baseline_required'"), 'posting must reject legacy lines without a physical baseline');
assert(resumeMigration.includes("status='counting'"), 'resume must select only editable count sessions');
assert(!resumeMigration.includes("status in ('counting','review')"), 'review sessions must not be resumed into an uneditable UI');

// Smart ordering: supplier reality must drive suggested quantities.
assert(procurementAdmin.includes('suggestedBaseQuantity'), 'supplier items must expose replenishment need');
assert(procurementAdmin.includes('minimum_order_quantity'), 'supplier item API must retain MOQ');
assert(procurementAdmin.includes('order_multiple'), 'supplier item API must retain order multiple');
assert(ordersUi.includes('suggestedPackCount'), 'order UI must convert base need into supplier packs');
assert(ordersUi.includes('Mindestbestellmenge'), 'supplier mapping must expose MOQ');
assert(ordersUi.includes('Bestellschritt'), 'supplier mapping must expose order multiple');
assert(ordersUi.includes('name="packUnitId"'), 'supplier mapping must let the manager select the real order pack');

// Sending is crash/retry-safe: durable claim before provider side effect and one
// deterministic provider key per PO/channel.
const sendStart=procurementOrder.indexOf('export async function sendPurchaseOrder');
const sendEnd=procurementOrder.indexOf('export async function confirmManualPurchaseOrderSent');
const sendSource=procurementOrder.slice(sendStart,sendEnd);
assert(sendStart>=0&&sendEnd>sendStart, 'sendPurchaseOrder source must be discoverable');
assert(sendSource.includes('const key=`send:${orderId}:${channel}`'), 'send key must be server-derived and deterministic');
assert(sendSource.includes('status:"sending"'), 'email delivery must be durably claimed as sending');
assert(sendSource.includes('"Idempotency-Key":key'), 'provider must receive the deterministic idempotency key');
assert(sendSource.indexOf('status:"sending"')<sendSource.indexOf('fetch("https://api.resend.com/emails"'), 'durable sending claim must happen before provider call');
assert(sendSource.includes('reconcileSentOrder'), 'retry after provider success must reconcile an unfinished PO commit');
assert(!ordersUi.includes('sendPurchaseOrder",{purchaseOrderId:orderId,channel:b.dataset.sendChannel,idempotencyKey:crypto.randomUUID()'), 'UI retries must not mint a new send identity');

console.log('inventory autopilot source gate passed');
