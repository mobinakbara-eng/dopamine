import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('app/index.html');
const contract=read('app/modules/inventory-session-contract.js');
const employee=read('app/modules/inventory-employee.js');
const router=read('supabase/functions/aora-v8-inventory-next/router-v3.ts');
const nextIndex=read('supabase/functions/aora-v8-inventory-next/index.ts');
const legacyIndex=read('supabase/functions/aora-v8-inventory/index.ts');
const schedulerIndex=read('supabase/functions/aora-v8-task-scheduler/index.ts');
const schedulerV2=read('supabase/functions/aora-v8-task-scheduler/scheduler-v2.ts');
const push=read('supabase/functions/aora-v8-push-dispatch/index.ts');
const pushMigration=read('supabase/migrations/202608170011_push_delivery_targets.sql');

assert(html.includes('inventory-session-contract.js'), 'inventory token contract must be loaded');
assert(html.indexOf('inventory-session-contract.js')<html.indexOf('inventory-employee.js'), 'token contract must load before employee scanner');
assert(html.includes('inventory-orders-v2.js'), 'corrected ordering module must be active');
assert(!html.includes('modules/inventory-orders.js?v='), 'retired malformed ordering module must not be active');

assert(contract.includes('sessionToken:S.session?.token'), 'frontend must send a distinct session token');
assert(contract.includes('payload.qrToken'), 'frontend must send QR value separately');
assert(contract.includes('delete payload.token'), 'QR payload must not overwrite session token');
assert(employee.includes('issueQrUnit'), 'employee scanner must call issueQrUnit');

assert(nextIndex.includes('router-v3.ts'), 'canonical inventory endpoint must use router v3');
assert(router.includes('body.sessionToken||body.token'), 'router must accept the explicit session token');
assert(router.includes('body.qrToken'), 'router must require a distinct QR token');
assert(router.indexOf('sessionContext(sessionToken')<router.indexOf('body={...body,token:qrToken}'), 'session must be validated before QR token is forwarded');
assert(legacyIndex.includes('aora-v8-inventory-next/router-v3.ts'), 'legacy inventory endpoint must share the canonical router');
assert(!legacyIndex.trim().includes('dummy'), 'legacy inventory endpoint cannot be a placeholder');

assert(schedulerIndex.includes('scheduler-v2.ts'), 'scheduler v2 must be active');
assert(schedulerV2.includes('PAGE_SIZE=250'), 'scheduler must page rules');
assert(schedulerV2.includes('RULE_CONCURRENCY=8'), 'scheduler must use bounded concurrency');
assert(!schedulerV2.includes('MAX_RULES=500'), 'scheduler v2 must not retain the 500 rule cap');

assert(push.includes('aora_push_claim_targets'), 'push dispatcher must atomically claim per-device targets');
assert(push.includes('claim_token'), 'push completion must be claim-token guarded');
assert(pushMigration.includes('notification_push_delivery_targets'), 'push target table migration must exist');
assert(pushMigration.includes('for update skip locked'), 'push claim must use skip-locked semantics');
assert(pushMigration.includes('attempts < 8'), 'push retries must be bounded');

console.log('inventory release source gate passed');
