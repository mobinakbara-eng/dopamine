import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(root, "..");
const read = path => readFile(resolve(repository, path), "utf8");
const [pilotWorkflow, timesheetWorkflow, realtime, monitor, bootstrap, timesheetBootstrap] = await Promise.all([
  read(".github/workflows/aora-v8-pilot-ci.yml"),
  read(".github/workflows/aora-timesheet-e2e.yml"),
  read("aora-v8-final/supabase/functions/aora-v8-pilot-realtime-broadcast/index.ts"),
  read("aora-v8-final/supabase/functions/aora-v8-pilot-monitor/index.ts"),
  read("aora-v8-final/supabase/functions/aora-v8-pilot-ci-bootstrap/bootstrap-v2.ts"),
  read("aora-v8-final/supabase/functions/aora-v8-timesheet-ci-bootstrap/bootstrap-v2.ts"),
]);

for (const [name, workflow] of [["pilot", pilotWorkflow], ["timesheet", timesheetWorkflow]]) {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/, `${name} must validate main pushes`);
  assert.match(workflow, /merge_group:/, `${name} must validate merge queue commits`);
  assert.match(workflow, /artifact-manifest\.sha256/, `${name} must hash its built artifact`);
  assert.match(workflow, /artifact-source\.txt/, `${name} must bind the artifact to github.sha`);
  assert.match(workflow, /sha256sum -c artifact-manifest\.sha256/, `${name} must verify the downloaded artifact`);
}
assert.match(pilotWorkflow, /deno check[\s\S]*aora-v8-pilot-realtime-broadcast\/index\.ts/);
assert.match(pilotWorkflow, /deno check[\s\S]*aora-v8-pilot-monitor\/index\.ts/);
assert.match(timesheetWorkflow, /deno check[\s\S]*aora-v8-timesheet-ci-bootstrap\/index\.ts/);
assert.match(timesheetWorkflow, /permissions:\s*\n\s*contents: read\s*\n\s*\nconcurrency:/, "Timesheet workflow-wide permissions must not grant OIDC");
assert.match(timesheetWorkflow, /timesheet-e2e:[\s\S]*?permissions:\s*\n\s*contents: read\s*\n\s*id-token: write/, "Only the OIDC bootstrap job must receive id-token: write");
assert.equal((timesheetWorkflow.match(/id-token: write/g) || []).length, 1, "Timesheet workflow must have exactly one OIDC-capable job");

for (const marker of [
  "ALLOWED_ACTOR_ROLES",
  "workspace_changes",
  "Number.isSafeInteger",
  "aora_consume_rate_limit",
  "retry_after_seconds",
  "MAX_BODY_BYTES",
]) assert.ok(realtime.includes(marker), `Realtime hardening marker missing: ${marker}`);
assert.ok(!realtime.includes("const recent=new Map"), "Realtime rate limiting must not depend on one isolate's memory");

for (const marker of [
  'payload.repository!==REPOSITORY',
  'actor===REPOSITORY_OWNER&&actorId===REPOSITORY_OWNER_ID',
  'MERGE_QUEUE_ACTOR_ID="118344674"',
  '["merge_group","push"].includes(eventName)&&mergeQueueActor',
  'eventName==="push"',
  'String(payload.ref||"")!=="refs/heads/main"',
  'eventName==="merge_group"',
  'String(payload.base_ref||"")!=="main"',
  'gh-readonly-queue\\/main',
  'runner_environment',
]) assert.ok(bootstrap.includes(marker), `OIDC bootstrap hardening marker missing: ${marker}`);

for (const marker of [
  'REPOSITORY="mobinakbara-eng/dopamine"',
  'REPOSITORY_ID="1044549733"',
  'REPOSITORY_OWNER_ID="228580584"',
  "WORKFLOW_PATH",
  "payload.repository!==REPOSITORY",
  'eventName==="pull_request"',
  'eventName==="push"',
  '"refs/heads/main"',
  'eventName==="merge_group"',
  "gh-readonly-queue\\/main",
  'eventName==="workflow_dispatch"',
  "runner_environment",
  "actor_id",
  "actor===REPOSITORY_OWNER&&actorId===REPOSITORY_OWNER_ID",
  'MERGE_QUEUE_ACTOR_ID="118344674"',
  '["merge_group","push"].includes(eventName)&&mergeQueueActor',
]) assert.ok(timesheetBootstrap.includes(marker), `Timesheet OIDC hardening marker missing: ${marker}`);
assert.ok(!timesheetBootstrap.includes("head_repository"), "Timesheet bootstrap must not require a non-standard OIDC head_repository claim");

for (const marker of [
  "MAX_BODY_BYTES",
  "MAX_METADATA_BYTES",
  "MAX_METADATA_DEPTH",
  "MAX_METADATA_ENTRIES",
  "metadata_must_be_object",
  "insertError",
  "monitor_storage_unavailable",
  "limitError",
]) assert.ok(monitor.includes(marker), `Monitor hardening marker missing: ${marker}`);

console.log("Zero-cost release, Realtime and monitor hardening contract passed.");
