import assert from "node:assert/strict";
import fs from "node:fs";

const ui=fs.readFileSync(new URL("../app/modules/inventory-catalog-media.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../app/inventory-catalog-media.css",import.meta.url),"utf8");
const media=fs.readFileSync(new URL("../supabase/functions/aora-v8-inventory-next/inventory-media.ts",import.meta.url),"utf8");
const endpoint=fs.readFileSync(new URL("../supabase/functions/aora-v8-inventory-media/index.ts",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../supabase/migrations/20260822111500_inventory_catalog_media.sql",import.meta.url),"utf8");
const index=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");

assert(ui.includes("S.inventorySelectedCategory"),"catalog needs explicit category selection state");
assert(ui.includes("inventoryCatalogCategoryCards"),"catalog must render categories first");
assert(ui.includes("Nur Artikel dieser Kategorie werden angezeigt"),"product list must be scoped to selected category");
assert(ui.includes("Meldebestand")&&ui.includes("inventoryCatalogDangerRows"),"low-stock products must surface directly in Meldebestand");
assert(ui.includes("suggestedQuantity")&&ui.includes("item_id"),"Meldebestand rows must come from real replenishment suggestions");
assert(ui.includes("data-supplier-select"),"supplier assignment must allow multi-select products");
assert(ui.includes("for(const itemId of selected)"),"supplier assignment must save every selected product");
assert(ui.includes("supplierItemId:existing?.id||null"),"existing supplier mappings must be editable, not duplicated");
assert(ui.includes("prepareInventoryImageUpload")&&ui.includes("confirmInventoryImageUpload"),"photos need prepare/confirm signed upload flow");
assert(ui.includes("uploadToSignedUrl"),"browser must upload through signed storage URL");
assert(index.indexOf("inventory-catalog-media.js")>index.indexOf("inventory-workspace-transfer.js"),"catalog override must load after transfer composition");
assert(index.includes("inventory-catalog-media.css"),"catalog media styles must ship in production artifact");
assert(css.includes("inventory-category-grid")&&css.includes("inventory-supplier-multi-map"),"category and multi-map layouts must be styled");

assert(migration.includes("add column if not exists image_path text"),"item and supplier photo paths must be additive columns");
assert(migration.includes("'inventory-media'"),"private inventory media bucket must be created");
assert(migration.includes("false")&&migration.includes("8388608"),"media bucket must be private and size-bounded");
assert(media.includes('await requirePermission(ctx,locationId,"procurement"'),"photo writes require procurement permission");
assert(media.includes('await requirePermission(ctx,locationId,"view"'),"signed photo reads require inventory view permission");
assert(media.includes("pathPrefix(ctx,k,entityId)"),"photo paths must be organization/entity scoped");
assert(media.includes("createSignedUploadUrl")&&media.includes("createSignedUrls"),"media must stay private behind signed URLs");
assert(endpoint.includes("sessionContext")&&endpoint.includes("requireFeature"),"media endpoint must keep session and feature authorization");

console.log("inventory catalog/media contract: ok");
