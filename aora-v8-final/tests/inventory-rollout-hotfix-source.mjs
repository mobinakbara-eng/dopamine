import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const countUi=read('app/modules/inventory-access-count.js');
const employeeUi=read('app/modules/inventory-employee.js');
const receiptMigration=read('supabase/migrations/20260821190000_inventory_receipt_line_idempotency_hotfix.sql');
const bootstrap=read('supabase/functions/aora-v8-inventory-load-ci-bootstrap/index.ts');

// Permanent count-save errors must stop the automatic retry loop until the user edits.
assert(countUi.includes('retryBlocked:false'), 'count line state must track permanent retry blocking');
assert(countUi.includes('st.retryBlocked=true'), 'non-retryable count save must block automatic retries');
assert(countUi.includes('st.retryBlocked=false'), 'successful save or user edit must clear the retry block');
assert(countUi.includes('!st.retryBlocked&&d.isConnected'), 'count retry scheduling must require an open modal and retryable state');
assert(countUi.includes('for(const st of states.values()){if(st.timer){clearTimeout(st.timer);st.timer=null}}'), 'closing a count modal must cancel pending autosave timers');

// FEFO action handling must survive explanatory/non-action taps.
assert(employeeUi.includes('const onFefoClick=async e=>'), 'FEFO must use a named delegated action handler');
assert(employeeUi.includes('host.addEventListener("click",onFefoClick)'), 'FEFO action handler must stay attached until a real action is selected');
assert(employeeUi.includes('host.removeEventListener("click",onFefoClick)'), 'FEFO handler must remove itself only after a valid action');
assert(!/data-fefo[\s\S]{0,1500}\{once:true\}/.test(employeeUi), 'FEFO action flow must not use a one-shot listener that non-action taps can consume');

// A delivery can contain the same item multiple times (e.g. separate lots/pack units).
assert(receiptMigration.includes("p_idempotency_key||':movement:'||v_line_no::text||':'||v_input.item_id::text"), 'receipt movement idempotency must be unique per good input line');
assert(receiptMigration.includes("where organization_id=p_organization_id and idempotency_key=p_idempotency_key"), 'whole-delivery replay must remain idempotent');
assert(receiptMigration.includes('revoke all on function public.aora_inventory_receive_purchase_order_delivery'), 'receipt RPC must remain protected from direct client execution');
assert(receiptMigration.includes('to service_role'), 'receipt RPC must remain service-role only');

// GitHub OIDC bootstrap policy must match the workflow's declared trigger scope.
assert(bootstrap.includes('const ALLOWED_PR_BASES=new Set(["main","agent/aora-inventory-production-ready"])'), 'bootstrap must allow both workflow PR base branches');
assert(bootstrap.includes('ALLOWED_PR_BASES.has(baseRef)'), 'PR bootstrap must enforce the approved base allowlist');
assert(bootstrap.includes('ref.startsWith("refs/heads/")'), 'manual dispatch must accept repository branch refs');
assert(bootstrap.includes('p.repository!==REPOSITORY')&&bootstrap.includes('REPOSITORY_ID'), 'bootstrap must remain repository-bound');
assert(bootstrap.includes('runner_environment')&&bootstrap.includes('github-hosted'), 'bootstrap must remain GitHub-hosted-runner bound');
assert(bootstrap.includes('workflow_ref')&&bootstrap.includes('WORKFLOW_PREFIX'), 'bootstrap must remain workflow-path bound');

console.log('inventory rollout hotfix source gate passed');
