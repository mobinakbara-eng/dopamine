import { performance } from "node:perf_hooks";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required load-test value: ${name}`);
  return value;
};

const supabaseUrl = required("AORA_SUPABASE_URL").replace(/\/+$/, "");
const workspaceSlug = required("AORA_WORKSPACE_SLUG");
const email = required("AORA_OWNER_EMAIL");
const password = required("AORA_OWNER_PASSWORD");
const expectedRole = process.env.AORA_LOAD_ACCESS_ROLE || "owner";
const requests = Math.max(10, Math.min(500, Number(process.env.AORA_LOAD_REQUESTS || 100)));
const concurrency = Math.max(1, Math.min(50, Number(process.env.AORA_LOAD_CONCURRENCY || 20)));
const p95BudgetMs = Math.max(500, Number(process.env.AORA_LOAD_P95_BUDGET_MS || 5000));
const accessUrl = `${supabaseUrl}/functions/v1/aora-v8-pilot-access`;
const workspaceUrl = `${supabaseUrl}/functions/v1/aora-v8-pilot-workspace-rules`;

async function post(url, payload) {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const elapsed = performance.now() - started;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${String(body?.error || "request failed").slice(0, 160)}`);
  }
  return { body, elapsed };
}

const login = await post(accessUrl, {
  action: "passwordLogin",
  workspaceSlug,
  email,
  password,
});
if (login.body.accessRole !== expectedRole || String(login.body.token || "").length !== 64) {
  throw new Error(`Load-test login did not return the expected ${expectedRole} session.`);
}

const timings = [];
const revisions = new Set();
let cursor = 0;
async function worker() {
  while (cursor < requests) {
    cursor += 1;
    const result = await post(workspaceUrl, { action: "load", token: login.body.token });
    timings.push(result.elapsed);
    revisions.add(Number(result.body.revision));
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));

timings.sort((a, b) => a - b);
const percentile = (value) => timings[Math.min(timings.length - 1, Math.ceil(timings.length * value) - 1)];
const p95 = percentile(0.95);
if (timings.length !== requests) throw new Error(`Only ${timings.length}/${requests} load requests completed.`);
if (revisions.size !== 1) throw new Error(`Inconsistent revisions observed: ${[...revisions].join(",")}`);
if (p95 > p95BudgetMs) throw new Error(`Load p95 ${p95.toFixed(0)}ms exceeded ${p95BudgetMs}ms budget.`);

await post(accessUrl, { action: "logout", workspaceSlug, token: login.body.token });
console.log(JSON.stringify({
  requests,
  concurrency,
  failures: 0,
  p50Ms: Math.round(percentile(0.50)),
  p95Ms: Math.round(p95),
  p99Ms: Math.round(percentile(0.99)),
  revision: [...revisions][0],
}));

