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
const inventoryReadOrders=read('supabase/functions/aora-v8-inventory-next/inventory-read-orders.ts');
const inventoryWriteCore=read('supabase/functions/aora-v8-inventory-next/inventory-write-core.ts');
const router=read('supabase/functions/aora-v8-inventory-next/router-v3.ts');
const procurementAdmin=read('supabase/functions/aora-v8-inventory-next/procurement-admin.ts');
const procurementOrder=read('supabase/functions/aora-v8-inventory-next/procurement-order.ts');
const baselineMigration=read('supabase/migrations/20260818194000_inventory_autopilot_count_baseline.sql');
const resumeMigration=read('supabase/migrations/20260818194100_inventory_count_resume_active_only.sql');
const transferFloorMigration=read('supabase/migrations/20260818201000_inventory_autopilot_transfer_floor.sql');

// Action-first UX: the first tab is not a passive stock table.
assert(core.includes('["overview","Heute"]'), 'inventory overview tab must be action-first Heute');
assert(core.includes('listReplenishment'), 'overview must consume server replenishment suggestions');
assert(core.includes('inventoryAutopilotAction'), 'overview must render autopilot action cards');
assert(core.includes('Bestellung vorbereiten'), 'low-stock action must lead directly into ordering');
assert(core.includes('inventoryMovements(d)'), 'stock view must render the ledger it fetches');
assert(core.includes('data-inv-stock-search'), 'stock view must have fast search');
assert(css.includes('.inventory-action-card'), 'autopilot action UI must be styled');

// Transfer Before Buy: Aora should prefer safe internal surplus over a supplier
// purchase, without pushing the donor location below its own safety floor.
assert(inventoryReadOrders.includes('export async function listTransferSuggestions'), 'backend must expose transfer-before-buy suggestions');
assert(inventoryReadOrders.includes('await requirePermission(ctx,destinationLocationId,"transfer_receive"'), 'destination must be authorized to receive transfer suggestions');
assert(inventoryReadOrders.includes('await hasPermission(ctx,locationId,"transfer_dispatch",requestId)'), 'only source locations authorized for dispatch may be suggested and the permission check must carry request context');
assert(inventoryReadOrders.includes('Number(balance.on_hand||0)-Number(balance.reserved||0)'), 'transferable stock must exclude reserved stock');
assert(inventoryReadOrders.includes('Math.max(Number(policy.reorder_point||0),Number(policy.par_level??0))'), 'source safety floor must protect both PAR and reorder point');
assert(inventoryReadOrders.includes('draftIncoming'), 'existing draft transfers must reduce the remaining suggestion');
assert(inventoryReadOrders.includes('need=Math.max(0,rawNeed-alreadyRequested)'), 'draft incoming must prevent duplicate transfer recommendations');
assert(router.includes('action==="listTransferSuggestions"'), 'router must expose transfer suggestions');
assert(router.includes('requireFeature(ctx,"replenishment_suggestions",locationId,requestId);data=await listTransferSuggestions'), 'transfer suggestions must be feature-gated');
assert(core.includes('invRequest("listTransferSuggestions"'), 'Heute overview must load transfer suggestions');
assert(core.includes('Besser als kaufen'), 'transfer recommendation must clearly explain why it is preferred');
assert(core.includes('Trotzdem bestellen'), 'manager must retain an explicit supplier-order override');
assert(core.includes('invStableOperationKey("transfer-before-buy"'), 'transfer creation must keep a stable retry identity');
assert(core.includes('sessionStorage.getItem(storageKey)'), 'stable transfer identity must survive same-session retries');
assert(core.includes('invRequest("createAutopilotTransfer"'), 'transfer-before-buy must use the protected Autopilot transfer path');
assert(core.includes('replenishmentEpisodeId:suggestion.episodeId||null'), 'transfer draft must preserve the replenishment episode identity');
assert(core.includes('Sicherheitsbestand dann erneut geprüft'), 'UI must explain that source safety is rechecked at dispatch');
assert(core.includes('Quelle bleibt bis zum Versand unverändert'), 'UI must make draft semantics explicit');
assert(css.includes('.inventory-action-card.transfer'), 'transfer recommendation must have a distinct but consistent treatment');

// Permissions must be symmetric: creating either a manual or Autopilot transfer
// requires dispatch rights at source and receive rights at destination.
assert(inventoryWriteCore.includes('export async function createAutopilotTransfer'), 'Edge API must expose protected Autopilot transfer creation');
assert(inventoryWriteCore.includes('aora_inventory_create_autopilot_transfer'), 'Autopilot transfer creation must call the floor-protected RPC');
const manualTransferStart=inventoryWriteCore.indexOf('export async function createTransfer');
const autopilotTransferStart=inventoryWriteCore.indexOf('export async function createAutopilotTransfer');
const changeTransferStart=inventoryWriteCore.indexOf('export async function changeTransfer');
assert(manualTransferStart>=0&&autopilotTransferStart>manualTransferStart, 'manual transfer source must be discoverable');
const manualTransferSource=inventoryWriteCore.slice(manualTransferStart,autopilotTransferStart);
const autopilotTransferSource=inventoryWriteCore.slice(autopilotTransferStart,changeTransferStart);
assert(manualTransferSource.includes('requirePermission(ctx,source,"transfer_dispatch",requestId)'), 'manual transfer must require source dispatch permission');
assert(manualTransferSource.includes('requirePermission(ctx,dest,"transfer_receive",requestId)'), 'manual transfer must require destination receive permission');
assert(autopilotTransferSource.includes('requirePermission(ctx,source,"transfer_dispatch",requestId)'), 'Autopilot transfer must require source dispatch permission');
assert(autopilotTransferSource.includes('requirePermission(ctx,dest,"transfer_receive",requestId)'), 'Autopilot transfer must require destination receive permission');
assert(autopilotTransferSource.includes('transfer_source_floor_changed'), 'stale source-floor conflicts must map to a user-safe 409');
assert(router.includes('action==="createAutopilotTransfer"'), 'router must expose protected Autopilot transfer creation');
assert(router.includes('requireFeature(ctx,"replenishment_suggestions",destinationLocationId,requestId)'), 'Autopilot transfer creation must remain behind replenishment feature flag');

// Postgres is the final authority. The source-floor rule is checked at draft
// creation and again immediately before dispatch while inventory rows are locked.
assert(transferFloorMigration.includes('enforce_source_floor boolean not null default false'), 'migration must mark only protected transfers for source-floor enforcement');
assert(transferFloorMigration.includes('replenishment_episode_id uuid'), 'migration must preserve replenishment episode audit identity');
assert(transferFloorMigration.includes('aora_inventory_create_autopilot_transfer'), 'migration must define protected Autopilot transfer creation');
assert(transferFloorMigration.includes('if v_transfer.enforce_source_floor then'), 'dispatch must re-check the source floor only for protected transfers');
assert(transferFloorMigration.includes('v_balance.on_hand-v_balance.reserved-v_line.requested_quantity < v_floor'), 'source floor must use live on-hand minus reserved minus requested quantity');
assert(transferFloorMigration.includes("message='inventory_transfer_source_floor_changed'"), 'stale safe-surplus recommendations must fail closed');
assert(transferFloorMigration.includes('for update;'), 'transfer floor checks must lock live balance rows');
assert(transferFloorMigration.includes('revoke all on function public.aora_inventory_create_autopilot_transfer'), 'protected RPC must not be client executable');
assert(transferFloorMigration.includes('grant execute on function public.aora_inventory_create_autopilot_transfer')&&transferFloorMigration.includes('to service_role'), 'protected RPC must only be executable by service role');

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
