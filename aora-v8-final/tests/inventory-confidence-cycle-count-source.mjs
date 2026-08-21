import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const migration=read('supabase/migrations/20260819144500_inventory_confidence_cycle_count.sql');
const api=read('supabase/functions/aora-v8-inventory-next/inventory-count-receive.ts');
const ui=read('app/modules/inventory-cycle-count.js');
const countUi=read('app/modules/inventory-access-count.js');
const index=read('app/index.html');

assert(migration.includes('aora_inventory_start_count_items'), 'database must expose targeted count creation');
assert(migration.includes('v_requested<1 or v_requested>100'), 'targeted count scope must be bounded');
assert(migration.includes("status='counting'"), 'targeted count must detect an already active count');
assert(migration.includes("'resumedDifferentScope'"), 'resume response must disclose when an existing count has a different scope');
assert(migration.includes('b.item_id=any(v_ids)'), 'count lines must be limited to requested item IDs');
assert(migration.includes('join public.inventory_item_locations'), 'only active location items may enter a targeted count');
assert(migration.includes('v_rows<>v_requested'), 'database must fail closed if requested scope cannot be materialized exactly');
assert(migration.includes('revoke all on function public.aora_inventory_start_count_items'), 'targeted-count RPC must deny direct client execution');
assert(migration.includes('grant execute on function public.aora_inventory_start_count_items')&&migration.includes('to service_role'), 'targeted-count RPC must be service-role only');

assert(api.includes('Array.isArray(body.itemIds)'), 'Edge API must accept an explicit targeted item set');
assert(api.includes('[...new Set(body.itemIds.map'), 'Edge API must deduplicate requested items');
assert(api.includes('itemIds.length>100'), 'Edge API must enforce targeted-count bound before database call');
assert(api.includes('aora_inventory_start_count_items'), 'Edge API must route targeted counts to dedicated RPC');
assert(api.includes('aora_inventory_start_count"'), 'full inventory counting path must remain available');

assert(ui.includes('Number(x.confidenceScore)<60'), 'quick count must target only low-confidence stock');
assert(ui.includes('.slice(0,50)'), 'quick count UI must stay intentionally small and fast');
assert(ui.includes('scope:"confidence_check",itemIds'), 'quick count must send an explicit auditable scope and item set');
assert(ui.includes('resumedDifferentScope'), 'UI must handle an already-open full inventory safely');
assert(ui.includes('statt parallel eine zweite zu starten'), 'UI must explain why it resumes instead of creating concurrent counts');
assert(ui.includes('blinde Schnellinventur'), 'quick verification must remain blind counting');
assert(ui.includes('inventory-focus-banner'), 'quick-count action must reuse the established action-first design');
assert(!ui.includes('systemQuantity'), 'quick-count launcher must never reveal expected stock');
assert(countUi.includes('Blind zählen'), 'targeted count must reuse the hardened blind-count experience');
assert(countUi.includes('inventoryCountQueueKey'), 'targeted count inherits offline count queue');

const accessPos=index.indexOf('modules/inventory-access-count.js');
const cyclePos=index.indexOf('modules/inventory-cycle-count.js');
assert(accessPos>=0&&cyclePos>accessPos, 'cycle-count module must load after the count UI it calls');

console.log('inventory confidence cycle count source gate passed');
