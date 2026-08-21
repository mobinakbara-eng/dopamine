import fs from "node:fs";
import { performance } from "node:perf_hooks";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required load-test value: ${name}`);
  return value;
};

const bootstrap = JSON.parse(fs.readFileSync(required("AORA_LOAD_BOOTSTRAP_FILE"), "utf8"));
const endpoint = required("AORA_INVENTORY_ENDPOINT");
const sessions = Array.isArray(bootstrap.sessionTokens) ? bootstrap.sessionTokens.map(String) : [];
const locationId = String(bootstrap.locationId || "");
const itemId = String(bootstrap.itemId || "");
const virtualUsers = 100;
const readP95BudgetMs = Math.max(500, Number(process.env.AORA_LOAD_READ_P95_BUDGET_MS || 8000));
const writeP95BudgetMs = Math.max(500, Number(process.env.AORA_LOAD_WRITE_P95_BUDGET_MS || 12000));
const outputPath = process.env.AORA_LOAD_RESULT_FILE || "inventory-load-100u-result.json";
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

if (sessions.length !== virtualUsers) throw new Error(`Expected ${virtualUsers} isolated sessions, got ${sessions.length}.`);
if (!locationId || !itemId) throw new Error("Load bootstrap did not return an inventory fixture.");
if (new Set(sessions).size !== virtualUsers) throw new Error("Load bootstrap returned duplicate session tokens.");

const timings = new Map();
const failures = [];
const warmupTimings = [];
let httpAttempts = 0;
let transientRetries = 0;
let firstAttemptTransientFailures = 0;
const pushTiming = (name, elapsed) => {
  if (!timings.has(name)) timings.set(name, []);
  timings.get(name).push(elapsed);
};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] || 0;
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryDelay = (attempt) => 100 * (2 ** attempt) + Math.floor(Math.random() * 80);

async function post(sessionToken, action, payload = {}, metric = action, options = {}) {
  const retries = Math.max(0, Number(options.retries || 0));
  const recordMetric = options.recordMetric !== false;
  const recordFailure = options.recordFailure !== false;
  const started = performance.now();
  const requestId = crypto.randomUUID();
  let last = { ok: false, status: 0, body: {}, elapsed: 0 };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    httpAttempts += 1;
    let response;
    let body = {};
    let status = 0;
    let networkError = null;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({ action, sessionToken, ...payload }),
      });
      status = response.status;
      body = await response.json().catch(() => ({}));
    } catch (error) {
      networkError = error;
    }

    const retryable = Boolean(networkError) || retryableStatuses.has(status);
    if ((networkError || !response?.ok) && retryable && attempt < retries) {
      if (attempt === 0) firstAttemptTransientFailures += 1;
      transientRetries += 1;
      await delay(retryDelay(attempt));
      continue;
    }

    const elapsed = performance.now() - started;
    last = { ok: Boolean(response?.ok), status, body, elapsed };
    if (recordMetric) pushTiming(metric, elapsed);
    if (!last.ok && recordFailure) {
      if (networkError) failures.push({ metric, kind: "network", message: String(networkError?.message || networkError).slice(0, 180) });
      else failures.push({ metric, kind: "http", status, code: body?.code || null });
    }
    return last;
  }
  return last;
}

// Warm a cold staging runtime in bounded batches before measuring steady-state concurrency.
// This is deliberately separate from measured latency, while transient cold-start retries remain visible in the report.
const warmupStarted = performance.now();
let warmupFailures = 0;
for (let offset = 0; offset < sessions.length; offset += 10) {
  const batch = sessions.slice(offset, offset + 10);
  const batchResults = await Promise.all(batch.map(async (sessionToken) => {
    const started = performance.now();
    const result = await post(sessionToken, "availability", { locationId }, "warmup:availability", { retries: 3, recordMetric: false, recordFailure: false });
    warmupTimings.push(performance.now() - started);
    return result;
  }));
  warmupFailures += batchResults.filter((result) => !result.ok).length;
}
const warmupWallMs = performance.now() - warmupStarted;
if (warmupFailures) throw new Error(`${warmupFailures}/${virtualUsers} warmup users could not reach inventory after retries.`);

const readActions = [
  ["overview", { locationId }],
  ["listStock", { locationId }],
  ["listMovements", { locationId, limit: 25 }],
  ["listReplenishment", { locationId }],
];

const readStarted = performance.now();
await Promise.all(sessions.map(async (sessionToken) => {
  for (const [action, payload] of readActions) {
    const result = await post(sessionToken, action, payload, `read:${action}`, { retries: 2 });
    if (!result.ok) return;
  }
}));
const readWallMs = performance.now() - readStarted;

const operationKeys = sessions.map((_, index) => `load-100u:${process.env.GITHUB_RUN_ID || "local"}:${process.env.GITHUB_RUN_ATTEMPT || "1"}:${index}`);
const writeStarted = performance.now();
const writes = await Promise.all(sessions.map((sessionToken, index) => post(sessionToken, "recordConsumption", {
  locationId,
  itemId,
  quantity: 1,
  reason: "load_test",
  referenceType: "load_test",
  referenceId: String(index),
  idempotencyKey: operationKeys[index],
}, "write:consume", { retries: 2 })));
const writeWallMs = performance.now() - writeStarted;

const replayStarted = performance.now();
const replays = await Promise.all(sessions.map((sessionToken, index) => post(sessionToken, "recordConsumption", {
  locationId,
  itemId,
  quantity: 1,
  reason: "load_test",
  referenceType: "load_test",
  referenceId: String(index),
  idempotencyKey: operationKeys[index],
}, "write:replay", { retries: 2 })));
const replayWallMs = performance.now() - replayStarted;

const finalStock = await post(sessions[0], "listStock", { locationId, search: "QA-LOAD-100U" }, "verify:listStock", { retries: 2 });
const finalMovements = await post(sessions[0], "listMovements", { locationId, limit: 200 }, "verify:listMovements", { retries: 2 });
const stockRow = finalStock.body?.items?.find?.((row) => String(row.itemId) === itemId);
const itemMovements = (finalMovements.body?.movements || []).filter((row) => String(row.item_id || row.itemId) === itemId);
const consumptionMovements = itemMovements.filter((row) => row.movement_type === "consumption");

const successfulWrites = writes.filter((r) => r.ok).length;
const successfulReplays = replays.filter((r) => r.ok).length;
const idempotentReplays = replays.filter((r) => r.ok && r.body?.idempotent === true).length;
const finalOnHand = Number(stockRow?.onHand);

const metricSummary = Object.fromEntries([...timings.entries()].map(([name, values]) => [name, {
  requests: values.length,
  p50Ms: Math.round(percentile(values, 0.50)),
  p95Ms: Math.round(percentile(values, 0.95)),
  p99Ms: Math.round(percentile(values, 0.99)),
  maxMs: Math.round(Math.max(...values)),
}]));
const readValues = [...timings.entries()].filter(([name]) => name.startsWith("read:")).flatMap(([, values]) => values);
const writeValues = timings.get("write:consume") || [];

const result = {
  virtualUsers,
  independentSessions: sessions.length,
  totalOperations: [...timings.values()].reduce((sum, values) => sum + values.length, 0),
  totalHttpAttempts: httpAttempts,
  warmup: {
    users: virtualUsers,
    concurrency: 10,
    wallMs: Math.round(warmupWallMs),
    p95Ms: Math.round(percentile(warmupTimings, 0.95)),
    failures: warmupFailures,
  },
  resilience: { firstAttemptTransientFailures, transientRetries, eventualFailures: failures.length },
  readPhase: { requests: readValues.length, wallMs: Math.round(readWallMs), p95Ms: Math.round(percentile(readValues, 0.95)) },
  writePhase: { requests: writeValues.length, wallMs: Math.round(writeWallMs), p95Ms: Math.round(percentile(writeValues, 0.95)), successfulWrites },
  replayPhase: { requests: replays.length, wallMs: Math.round(replayWallMs), successfulReplays, idempotentReplays },
  integrity: { seedOnHand: Number(bootstrap.seedOnHand), finalOnHand, consumptionMovementCount: consumptionMovements.length },
  metrics: metricSummary,
  failures: failures.slice(0, 25),
  failureCount: failures.length,
};
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

if (failures.length) throw new Error(`${failures.length} load operations failed after retries.`);
if (successfulWrites !== virtualUsers) throw new Error(`Only ${successfulWrites}/${virtualUsers} concurrent writes succeeded.`);
if (successfulReplays !== virtualUsers || idempotentReplays !== virtualUsers) throw new Error("Idempotency replay did not succeed for all virtual users.");
if (finalOnHand !== 0) throw new Error(`Expected final on-hand 0 after 100 concurrent consumes, got ${finalOnHand}.`);
if (consumptionMovements.length !== virtualUsers) throw new Error(`Expected exactly ${virtualUsers} consumption movements, got ${consumptionMovements.length}.`);
if (percentile(readValues, 0.95) > readP95BudgetMs) throw new Error(`Read p95 exceeded ${readP95BudgetMs}ms budget.`);
if (percentile(writeValues, 0.95) > writeP95BudgetMs) throw new Error(`Write p95 exceeded ${writeP95BudgetMs}ms budget.`);
