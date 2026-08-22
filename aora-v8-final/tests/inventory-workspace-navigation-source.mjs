import assert from "node:assert/strict";
import fs from "node:fs";

const nav=fs.readFileSync(new URL("../app/modules/inventory-simple-navigation.js",import.meta.url),"utf8");
const qr=fs.readFileSync(new URL("../app/modules/inventory-qr-manager.js",import.meta.url),"utf8");
const receive=fs.readFileSync(new URL("../app/modules/inventory-orders-v2.js",import.meta.url),"utf8");
const receiptSql=fs.readFileSync(new URL("../supabase/migrations/20260819142500_inventory_expiry_qr_tracking.sql",import.meta.url),"utf8");

assert(!nav.includes("inventorySimpleChoicePage"),"Bestand must not render a separate chooser page");
assert(nav.includes('S.inventorySection=["orders","qr"]'),"only Bestellen and QR-Code may be inventory destinations");
assert(nav.includes("S.inventoryMenuOpen=!S.inventoryMenuOpen"),"Bestand parent must toggle its submenu");
assert(nav.includes("event.stopImmediatePropagation()"),"Bestand parent must not fall through to generic admin navigation");
assert(nav.includes('data-inventory-route="qr"')&&nav.includes('data-inventory-route="orders"'),"sidebar must expose QR-Code and Bestellen children");
assert(nav.includes('if(!open)return;'),"submenu must not be permanently rendered");

assert(nav.includes('invRequest("listPurchaseOrders"'),"Bestellen/QR workspaces must use real purchase orders");
assert(nav.includes('invRequest("listPrintJobs"'),"QR workspace must be driven by real print jobs");
assert(nav.includes('data-inventory-receive-order'),"Bestellen must expose goods receipt on receivable orders");
assert(nav.includes("receiveOrderModal(receive.dataset.inventoryReceiveOrder)"),"goods receipt must reuse the hardened receipt flow");
assert(nav.includes('S.inventoryPageCache[`${invKey()}:receiving`]'),"receipt modal compatibility cache must be populated");
assert(nav.includes('S.inventoryPageCache[`${invKey()}:orders`]'),"send-order compatibility cache must be populated");

assert(nav.includes('invRequest("createItem"'),"Bestellen must support product creation");
assert(nav.includes('invRequest("createPackUnit"'),"product creation must capture real packaging quantity");
assert(nav.includes('invRequest("upsertSupplierItem"'),"product creation must optionally map to a supplier");
assert(nav.includes("Neue Eingabe = neue Kategorie"),"category creation must be available in product flow");

assert(!nav.includes('invRequest("receiveQrUnits"'),"normal QR workspace must never invent/book extra goods receipt");
assert(!nav.includes("qrManagerModal()"),"normal QR navigation must not reopen the legacy direct-receipt modal");
assert(nav.includes("prepareExistingPrintJob"),"QR printing must prepare an existing receipt-created print job");
assert(nav.includes('invRequest("confirmPrintJob"'),"QR print confirmation must remain explicit");
assert(nav.includes("erst nach bestätigtem Wareneingang"),"QR UI must explain receipt gating");

assert(receive.includes('invRequest("receivePurchaseOrderDelivery"'),"receipt UI must book through purchase-order receiving");
assert(receiptSql.includes("if v_pack.is_stock_unit then"),"receipt RPC must gate QR jobs on QR-capable packaging");
assert(receiptSql.includes("insert into public.inventory_label_print_jobs"),"receipt RPC must create QR print jobs");
assert(qr.includes('invRequest("receiveQrUnits"'),"legacy direct QR receipt helper remains isolated for compatibility, not normal navigation");

console.log("inventory workspace navigation contract: ok");
