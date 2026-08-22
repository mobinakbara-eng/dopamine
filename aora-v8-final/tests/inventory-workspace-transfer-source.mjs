import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../app/modules/inventory-workspace-transfer.js",import.meta.url),"utf8");
const index=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");

assert(index.includes("modules/inventory-workspace-transfer.js"),"transfer bridge must be loaded after the two-area inventory workspace");
assert(source.includes('invRequest("listTransferSuggestions"'),"Bestellen must still ask for Transfer Before Buy suggestions");
assert(source.includes('invRequest("listTransfers"'),"Bestellen must expose active transfer lifecycle state");
assert(source.includes('data-inv="autopilot-transfer"'),"safe transfer suggestion must reuse hardened Autopilot transfer creation");
assert(source.includes('"dispatchTransfer"')&&source.includes('"receiveTransfer"')&&source.includes('"cancelTransfer"'),"Bestellen must preserve dispatch, receive and cancel actions");
assert(source.includes('S.inventoryPageCache[`${invKey()}:overview`]'),"existing hardened Autopilot transfer modal must receive its canonical context");
assert(source.includes("Bestand wird erst beim tatsächlichen Versand reduziert"),"UI must preserve the no-early-stock-deduction invariant");

console.log("inventory workspace transfer contract: ok");
