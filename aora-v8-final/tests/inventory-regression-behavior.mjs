import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const transferSource=fs.readFileSync(new URL("../app/modules/inventory-workspace-transfer.js",import.meta.url),"utf8");
const orderSource=fs.readFileSync(new URL("../app/modules/inventory-orders-v2.js",import.meta.url),"utf8");
const navigationSource=fs.readFileSync(new URL("../app/modules/inventory-simple-navigation.js",import.meta.url),"utf8");
const inventoryWrite=fs.readFileSync(new URL("../supabase/functions/aora-v8-inventory-next/inventory-write-core.ts",import.meta.url),"utf8");
const inventoryMigration=fs.readFileSync(new URL("../supabase/migrations/20260822090000_inventory_atomic_product_bundle.sql",import.meta.url),"utf8");

function transferContext(invRequest){
  const context={
    S:{adminView:"inventory",inventorySection:"orders",locationId:"loc-a",inventoryWorkspaceCache:{orders:{stock:{},replenishment:{}}},inventoryPageCache:{}},
    invRequest,inventoryWorkspaceKey:()=>"orders",invKey:()=>"loc-a",renderAdmin(){},esc:String,
    invUom:()=>"piece",invNumber:String,loc:id=>({name:id}),inventoryOrdersWorkspacePage:()=>"<main></main>",
    app:{addEventListener(){}},queueMicrotask,crypto,loadInventoryWorkspace:async()=>{},
  };
  vm.createContext(context);
  vm.runInContext(transferSource,context);
  return context;
}

{
  const context=transferContext(async action=>{
    if(action==="listTransferSuggestions")throw Object.assign(new Error("network down"),{status:503});
    return{transfers:[]};
  });
  await context.loadInventoryWorkspaceTransfers(true);
  const data=context.S.inventoryWorkspaceCache.orders;
  assert.equal(data.transferSuggestions.status,"check_failed","a failed transfer check must not become an empty successful result");
  assert.match(context.inventoryWorkspaceTransferSection(data),/erneut prüfen/i,"failed transfer checks must expose a retry action");
}

{
  const context=transferContext(async action=>action==="listTransferSuggestions"?{suggestions:[]}:{transfers:[]});
  await context.loadInventoryWorkspaceTransfers(true);
  assert.equal(context.S.inventoryWorkspaceCache.orders.transferSuggestions.status,"checked_no_transfer_available");
}

{
  const context={app:{addEventListener(){}},S:{},crypto,queueMicrotask};
  vm.createContext(context);
  vm.runInContext(orderSource,context);
  const candidate={pack:{base_quantity:6},minimum_order_quantity:2,order_multiple:2,suggestedBaseQuantity:12};
  assert.equal(context.suggestedPackCount(candidate,12),2,"12 base units with a 6-unit pack and min/multiple 2 must order 2 packs");
}

assert.match(navigationSource,/data-order-focus-item=/,"each replenishment CTA must carry its item id");
assert.match(navigationSource,/data-order-focus-quantity=/,"each replenishment CTA must carry its required base quantity");
assert.match(navigationSource,/S\.inventoryOrderFocus=\{itemId:/,"the CTA click must establish order focus before opening the order modal");
assert.match(navigationSource,/invRequest\("createProductBundle"/,"product setup must use one composite backend action");
assert.doesNotMatch(navigationSource,/createdItemId|null,createdPackId/,"the UI must not resume a partially-created product chain");
assert.match(inventoryWrite,/aora_inventory_create_product_bundle/);
assert.match(inventoryMigration,/pg_advisory_xact_lock/);
assert.match(inventoryMigration,/inventory_product_creation_requests/);
assert.match(inventoryMigration,/revoke all on function public\.aora_inventory_create_product_bundle/);
assert.match(navigationSource,/requestedSessionToken=String\(S\.session\?\.token/,"workspace reads must bind to the initiating tenant session");
assert.match(navigationSource,/String\(S\.locationId\)!==requestedLocationId/,"location switches must discard stale responses");

console.log("inventory regression behavior: ok");
