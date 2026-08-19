import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const core=read('app/modules/inventory-core.js');
const countUi=read('app/modules/inventory-access-count.js');
const employeeUi=read('app/modules/inventory-employee.js');
const ordersUi=read('app/modules/inventory-orders-v2.js');
const css=read('app/inventory.css');
const countApi=read('supabase/functions/aora-v8-inventory-next/inventory-count-receive.ts');
const qrApi=read('supabase/functions/aora-v8-inventory-next/inventory-write-qr.ts');
const insightsApi=read('supabase/functions/aora-v8-inventory-next/inventory-insights.ts');
const inventoryReadOrders=read('supabase/functions/aora-v8-inventory-next/inventory-read-orders.ts');
const inventoryWriteCore=read('supabase/functions/aora-v8-inventory-next/inventory-write-core.ts');
const router=read('supabase/functions/aora-v8-inventory-next/router-v3.ts');
const procurementAdmin=read('supabase/functions/aora-v8-inventory-next/procurement-admin.ts');
const procurementOrder=read('supabase/functions/aora-v8-inventory-next/procurement-order.ts');
const baselineMigration=read('supabase/migrations/20260818194000_inventory_autopilot_count_baseline.sql');
const resumeMigration=read('supabase/migrations/20260818194100_inventory_count_resume_active_only.sql');
const transferFloorMigration=read('supabase/migrations/20260818201000_inventory_autopilot_transfer_floor.sql');
const offlineCountMigration=read('supabase/migrations/20260819114500_inventory_offline_count_baseline.sql');
const partialQrMigration=read('supabase/migrations/20260819114600_inventory_partial_qr.sql');
const receiptMigration=read('supabase/migrations/20260819114700_inventory_exception_receiving.sql');
const qrInspectionMigration=read('supabase/migrations/20260819114800_inventory_qr_inspection.sql');

// Action-first UX: the first tab is not a passive stock table.
assert(core.includes('["overview","Heute"]'), 'inventory overview tab must be action-first Heute');
assert(core.includes('listReplenishment'), 'overview must consume server replenishment suggestions');
assert(core.includes('inventoryAutopilotAction'), 'overview must render autopilot action cards');
assert(core.includes('Bestellung vorbereiten'), 'low-stock action must lead directly into ordering');
assert(core.includes('inventoryMovements(d)'), 'stock view must render the ledger it fetches');
assert(core.includes('data-inv-stock-search'), 'stock view must have fast search');
assert(css.includes('.inventory-action-card'), 'autopilot action UI must be styled');

// Transfer Before Buy: safe internal surplus is preferred without risking donor stock.
assert(inventoryReadOrders.includes('export async function listTransferSuggestions'), 'backend must expose transfer-before-buy suggestions');
assert(inventoryReadOrders.includes('await requirePermission(ctx,destinationLocationId,"transfer_receive"'), 'destination must be authorized to receive transfer suggestions');
assert(inventoryReadOrders.includes('await hasPermission(ctx,locationId,"transfer_dispatch",requestId)'), 'only authorized source locations may be suggested');
assert(inventoryReadOrders.includes('Number(balance.on_hand||0)-Number(balance.reserved||0)'), 'transferable stock must exclude reserved stock');
assert(inventoryReadOrders.includes('Math.max(Number(policy.reorder_point||0),Number(policy.par_level??0))'), 'source safety floor must protect PAR and reorder point');
assert(inventoryReadOrders.includes('draftIncoming'), 'existing draft transfers must reduce remaining suggestion');
assert(inventoryReadOrders.includes('need=Math.max(0,rawNeed-alreadyRequested)'), 'draft incoming must prevent duplicate recommendations');
assert(router.includes('action==="listTransferSuggestions"'), 'router must expose transfer suggestions');
assert(router.includes('requireFeature(ctx,"replenishment_suggestions",locationId,requestId);data=await listTransferSuggestions'), 'transfer suggestions must be feature-gated');
assert(core.includes('invRequest("listTransferSuggestions"'), 'Heute must load transfer suggestions');
assert(core.includes('Besser als kaufen'), 'transfer recommendation must explain why it is preferred');
assert(core.includes('Trotzdem bestellen'), 'manager must retain supplier-order override');
assert(core.includes('invStableOperationKey("transfer-before-buy"'), 'transfer creation must keep a stable retry identity');
assert(core.includes('sessionStorage.getItem(storageKey)'), 'stable transfer identity must survive same-session retries');
assert(core.includes('invRequest("createAutopilotTransfer"'), 'transfer-before-buy must use protected path');
assert(core.includes('replenishmentEpisodeId:suggestion.episodeId||null'), 'transfer must preserve replenishment episode');
assert(core.includes('Sicherheitsbestand dann erneut geprüft'), 'UI must explain dispatch-time safety recheck');
assert(core.includes('Quelle bleibt bis zum Versand unverändert'), 'UI must explain draft semantics');
assert(css.includes('.inventory-action-card.transfer'), 'transfer recommendation must be styled');

// Permissions must be symmetric.
assert(inventoryWriteCore.includes('export async function createAutopilotTransfer'), 'Edge API must expose protected Autopilot transfer creation');
assert(inventoryWriteCore.includes('aora_inventory_create_autopilot_transfer'), 'Autopilot transfer must call floor-protected RPC');
const manualTransferStart=inventoryWriteCore.indexOf('export async function createTransfer');
const autopilotTransferStart=inventoryWriteCore.indexOf('export async function createAutopilotTransfer');
const changeTransferStart=inventoryWriteCore.indexOf('export async function changeTransfer');
assert(manualTransferStart>=0&&autopilotTransferStart>manualTransferStart, 'manual transfer source must be discoverable');
const manualTransferSource=inventoryWriteCore.slice(manualTransferStart,autopilotTransferStart);
const autopilotTransferSource=inventoryWriteCore.slice(autopilotTransferStart,changeTransferStart);
assert(manualTransferSource.includes('requirePermission(ctx,source,"transfer_dispatch",requestId)'), 'manual transfer must require source dispatch');
assert(manualTransferSource.includes('requirePermission(ctx,dest,"transfer_receive",requestId)'), 'manual transfer must require destination receive');
assert(autopilotTransferSource.includes('requirePermission(ctx,source,"transfer_dispatch",requestId)'), 'Autopilot transfer must require source dispatch');
assert(autopilotTransferSource.includes('requirePermission(ctx,dest,"transfer_receive",requestId)'), 'Autopilot transfer must require destination receive');
assert(autopilotTransferSource.includes('transfer_source_floor_changed'), 'stale floor conflict must map to a safe 409');
assert(router.includes('action==="createAutopilotTransfer"'), 'router must expose protected Autopilot transfer creation');
assert(router.includes('requireFeature(ctx,"replenishment_suggestions",destinationLocationId,requestId)'), 'Autopilot transfer must remain feature-gated');

// Postgres is final authority for source floor.
assert(transferFloorMigration.includes('enforce_source_floor boolean not null default false'), 'migration must mark protected transfers');
assert(transferFloorMigration.includes('replenishment_episode_id uuid'), 'migration must preserve episode identity');
assert(transferFloorMigration.includes('aora_inventory_create_autopilot_transfer'), 'migration must define protected transfer creation');
assert(transferFloorMigration.includes('if v_transfer.enforce_source_floor then'), 'dispatch must recheck protected transfer floor');
assert(transferFloorMigration.includes('v_balance.on_hand-v_balance.reserved-v_line.requested_quantity < v_floor'), 'source floor must use live available stock');
assert(transferFloorMigration.includes("message='inventory_transfer_source_floor_changed'"), 'stale recommendations must fail closed');
assert(transferFloorMigration.includes('for update;'), 'floor checks must lock live rows');
assert(transferFloorMigration.includes('revoke all on function public.aora_inventory_create_autopilot_transfer'), 'protected RPC must not be client executable');
assert(transferFloorMigration.includes('to service_role'), 'protected RPC must be service-role only');

// Blind + offline-safe physical counting.
assert(!countUi.includes('systemQuantity'), 'blind count UI must never reveal system quantity');
assert(countUi.includes('Blind zählen'), 'count UI must explain blind counting');
assert(countUi.includes('data-baseline'), 'count UI must distinguish saved baselines');
assert(countUi.includes('runCountPool(inputs,6,input=>saveInput(input))'), 'final count flush must use bounded concurrency');
assert(countUi.includes('setTimeout(()=>saveInput(input)'), 'count lines must autosave');
assert(countUi.includes('Später fortsetzen'), 'count sessions must be resumable');
assert(countUi.includes('inventoryCountQueueKey'), 'count UI must keep a durable offline queue');
assert(countUi.includes('countedAt:st.countedAt'), 'offline count replay must preserve original physical count timestamp');
assert(countUi.includes('window.addEventListener("online"'), 'count queue must flush when connectivity returns');
assert(countUi.includes('Inventur ist offline gespeichert'), 'offline completion must fail safe instead of posting incomplete data');
assert(countApi.includes('aora_inventory_set_count_line_at'), 'count API must use timestamp-aware atomic RPC');
assert(countApi.includes('p_counted_at:countedAt'), 'count API must send original physical count time to Postgres');
assert(countApi.includes('client_counted_at,baseline_reconstructed'), 'count API must expose reconstruction metadata');
assert(baselineMigration.includes('baseline_version integer'), 'baseline migration must persist balance version');
assert(baselineMigration.includes('baseline_captured_at timestamptz'), 'baseline migration must persist capture time');
assert(baselineMigration.includes("message='inventory_count_baseline_required'"), 'posting must reject legacy lines without a physical baseline');
assert(resumeMigration.includes("status='counting'"), 'resume must select only editable counts');
assert(!resumeMigration.includes("status in ('counting','review')"), 'review counts must not resume as editable');
assert(offlineCountMigration.includes('client_counted_at timestamptz'), 'offline migration must persist client physical time');
assert(offlineCountMigration.includes('baseline_reconstructed boolean'), 'offline migration must mark reconstructed baselines');
assert(offlineCountMigration.includes('occurred_at>v_at'), 'historical baseline must replay immutable movements after physical count time');
assert(offlineCountMigration.includes('v_baseline:=v_balance.on_hand-v_after'), 'offline baseline must reconstruct historical on-hand');
assert(offlineCountMigration.includes("message='inventory_count_timestamp_invalid'"), 'stale or impossible device timestamps must fail closed');
assert(offlineCountMigration.includes('for update;'), 'offline reconstruction must lock the live balance');

// Smart ordering: supplier reality drives suggested quantities.
assert(procurementAdmin.includes('suggestedBaseQuantity'), 'supplier items must expose replenishment need');
assert(procurementAdmin.includes('minimum_order_quantity'), 'supplier item API must retain MOQ');
assert(procurementAdmin.includes('order_multiple'), 'supplier item API must retain order multiple');
assert(ordersUi.includes('suggestedPackCount'), 'order UI must convert base need into supplier packs');
assert(ordersUi.includes('Mindestbestellmenge'), 'supplier mapping must expose MOQ');
assert(ordersUi.includes('Bestellschritt'), 'supplier mapping must expose order multiple');
assert(ordersUi.includes('name="packUnitId"'), 'supplier mapping must let manager select real order pack');

// Sending is crash/retry-safe.
const sendStart=procurementOrder.indexOf('export async function sendPurchaseOrder');
const sendEnd=procurementOrder.indexOf('export async function confirmManualPurchaseOrderSent');
const sendSource=procurementOrder.slice(sendStart,sendEnd);
assert(sendStart>=0&&sendEnd>sendStart, 'sendPurchaseOrder source must be discoverable');
assert(sendSource.includes('const key=`send:${orderId}:${channel}`'), 'send key must be server-derived and deterministic');
assert(sendSource.includes('status:"sending"'), 'email delivery must be durably claimed');
assert(sendSource.includes('"Idempotency-Key":key'), 'provider must receive deterministic idempotency key');
assert(sendSource.indexOf('status:"sending"')<sendSource.indexOf('fetch("https://api.resend.com/emails"'), 'sending claim must happen before provider side effect');
assert(sendSource.includes('reconcileSentOrder'), 'retry after provider success must reconcile unfinished PO commit');
assert(!ordersUi.includes('sendPurchaseOrder",{purchaseOrderId:orderId,channel:b.dataset.sendChannel,idempotencyKey:crypto.randomUUID()'), 'UI retry must not mint a new send identity');

// Exception-first receiving: normal path is one tap; only discrepancies need input.
assert(receiptMigration.includes('inventory_receipt_exceptions'), 'schema must persist supplier delivery exceptions');
assert(receiptMigration.includes("exception_type in ('damaged','missing','rejected')"), 'exception types must be explicit');
assert(receiptMigration.includes('aora_inventory_receive_purchase_order_delivery'), 'receiving must be one atomic delivery RPC');
assert(receiptMigration.includes('received_with_exceptions'), 'receipt audit state must distinguish discrepancies');
assert(receiptMigration.includes('v_good:=coalesce(v_input.good_pack_count,0)*v_pack.base_quantity'), 'only good delivered packs may enter stock');
assert(receiptMigration.includes("'damaged'"), 'damaged packs must be audit evidence');
assert(receiptMigration.includes("'missing'"), 'missing packs must be audit evidence');
assert(countApi.includes('export async function receivePurchaseOrderDelivery'), 'Edge API must expose atomic delivery receiving');
assert(router.includes('action==="receivePurchaseOrderDelivery"'), 'router must expose delivery receiving');
assert(ordersUi.includes('Nur Abweichungen eintragen'), 'receiving UI must default to everything arrived');
assert(ordersUi.includes('name="damaged"'), 'receiving UI must support damaged packs');
assert(ordersUi.includes('name="missing"'), 'receiving UI must support missing packs');
assert(ordersUi.includes('invStableOperationKey("receive-delivery"'), 'receiving retry must keep a stable identity');
assert(ordersUi.includes('invRequest("receivePurchaseOrderDelivery"'), 'receiving UI must use atomic batch RPC');
assert(css.includes('.inventory-delivery-exceptions'), 'exception receiving must be styled');

// Partial QR consumption: one label can safely represent a partially consumed pack.
assert(partialQrMigration.includes("consumption_mode text not null default 'whole_pack'"), 'items must opt into partial consumption explicitly');
assert(partialQrMigration.includes('remaining_quantity numeric(20,6)'), 'stock units must persist remaining quantity');
assert(partialQrMigration.includes('aora_inventory_consume_stock_unit'), 'partial consumption must be atomic in Postgres');
assert(partialQrMigration.includes('p_idempotency_key'), 'partial consumption must be idempotent');
assert(partialQrMigration.includes("status=case when v_remaining=0 then 'issued' else 'available' end"), 'partial QR must remain active until empty');
assert(partialQrMigration.includes('perform public.aora_inventory_evaluate_replenishment'), 'partial consumption must update replenishment state');
assert(qrInspectionMigration.includes('aora_inventory_inspect_qr_unit'), 'QR must be inspectable before partial confirmation');
assert(qrApi.includes('export async function inspectQrUnit'), 'Edge API must expose QR inspection');
assert(qrApi.includes('export async function setItemConsumptionPolicy'), 'manager must be able to configure per-item consumption policy');
assert(router.includes('"inspectQrUnit","inspectQrShortCode","issueQrUnit","issueQrShortCode"'), 'employee allowlist must permit safe inspection and consumption only');
assert(router.includes('action==="setItemConsumptionPolicy"'), 'router must expose consumption policy configuration');
assert(employeeUi.includes('inspectQrUnit'), 'employee scanner must inspect QR policy before online consumption');
assert(employeeUi.includes('inventoryScanQueueKey'), 'employee scanner must keep a bounded offline queue');
assert(employeeUi.includes('idempotencyKey:operation.idempotencyKey'), 'offline replay must keep the exact same operation identity');
assert(employeeUi.includes('partial_pack'), 'employee scanner must support partial-pack confirmation');
assert(employeeUi.includes('remainingQuantity'), 'partial UI must cap quantity at label remainder');
assert(employeeUi.includes('window.addEventListener("online"'), 'employee scan queue must flush on reconnect');
assert(core.includes('QR-Verbrauchsregeln'), 'manager stock UI must expose QR policy controls');
assert(core.includes('setItemConsumptionPolicy'), 'manager UI must persist QR policy through Edge API');
assert(css.includes('.inventory-partial-card'), 'partial consumption UI must be styled');

// Operational intelligence: forecasts are evidence-gated and loss signals never accuse.
assert(insightsApi.includes('depletions.length>=3'), 'days-to-empty must require a minimum real depletion sample');
assert(insightsApi.includes('forecastConfidence'), 'forecast must expose confidence level');
assert(insightsApi.includes('unexplainedVariance30d'), 'loss detective must separate unexplained count variance');
assert(insightsApi.includes('waste30d'), 'loss detective must separate waste');
assert(insightsApi.includes('receiptException30d'), 'loss detective must separate supplier exceptions');
assert(insightsApi.includes('confidenceScore'), 'stock confidence must be explicit and bounded');
assert(insightsApi.includes('lastCountAt'), 'confidence must include physical count recency');
assert(router.includes('action==="listInventoryInsights"'), 'router must expose inventory insights');
assert(core.includes('invRequest("listInventoryInsights"'), 'Heute and stock views must load insights');
assert(core.includes('Loss Detective'), 'manager UI must surface loss detective');
assert(core.includes('keine Diebstahlannahmen'), 'loss detective must not accuse theft');
assert(core.includes('Bestandsvertrauen'), 'stock rows must surface confidence signal');
assert(css.includes('.inventory-signal-kpis'), 'inventory signals must be styled');

console.log('inventory autopilot source gate passed');
