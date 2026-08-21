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

if (sessions.length !== virtualUsers) throw new Error(`Expected ${virtualUsers} isolated sessions, got ${sessions.length}.`);
if (!locationId || !itemId) throw new Error("Load bootstrap did not return an inventory fixture.");
if (new Set(sessions).size !== virtualUsers) throw new Error("Load bootstrap returned duplicate session tokens.");

const timings = new Map();
const failures = [];
const pushTiming = (name, elapsed) => {
  if (!timings.has(name)) timings.set(name, []);
  timings.get(name).push(elapsed);
};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] || 0;
};

async function post(sessionToken, action, payload = {}, metric = action) {
  const started = performance.now();
  let response;
  let body = {};
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() },
      body: JSON.stringify({ action, sessionToken, ...payload }),
    });
    body = await response.json().catch(() => ({}));
  } catch (error) {
    const elapsed = performance.now() - started;
    pushTiming(metric, elapsed);
    failures.push({ metric, kind: "network", message: String(error?.message || error).slice(0, 180) });
    return { ok: false, status: 0, body, elapsed };
  }
  const elapsed = performance.now() - started;
  pushTiming(metric, elapsed);
  if (!response.ok) failures.push({ metric, kind: "http", status: response.status, code: body?.code || null });
  return { ok: response.ok, status: response.status, body, elapsed };
}

const readActions = [
  ["overview", { locationId }],
  ["listStock", { locationId }],
  ["listMovements", { locationId, limit: 25 }],
  ["listReplenishment", { locationId }],
];

const readStarted = performance.now();
await Promise.all(sessions.map(async (sessionToken) => {
  for (const [action, payload] of readActions) {
    const result = await post(sessionToken, action, payload, `read:${action}`);
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
}, "write:consume")));
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
}, "write:replay")));
const replayWallMs = performance.now() - replayStarted;

const finalStock = await post(sessions[0], "listStock", { locationId, search: "QA-LOAD-100U" }, "verify:listStock");
const finalMovements = await post(sessions[0], "listMovements", { locationId, limit: 200 }, "verify:listMovements");
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
  totalHttpRequests: [...timings.values()].reduce((sum, values) => sum + values.length, 0),
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

if (failures.length) throw new Error(`${failures.length} load requests failed.`);
if (successfulWrites !== virtualUsers) throw new Error(`Only ${successfulWrites}/${virtualUsers} concurrent writes succeeded.`);
if (successfulReplays !== virtualUsers || idempotentReplays !== virtualUsers) throw new Error("Idempotency replay did not succeed for all virtual users.");
if (finalOnHand !== 0) throw new Error(`Expected final on-hand 0 after 100 concurrent consumes, got ${finalOnHand}.`);
if (consumptionMovements.length !== virtualUsers) throw new Error(`Expected exactly ${virtualUsers} consumption movements, got ${consumptionMovements.length}.`);
if (percentile(readValues, 0.95) > readP95BudgetMs) throw new Error(`Read p95 exceeded ${readP95BudgetMs}ms budget.`);
if (percentile(writeValues, 0.95) > writeP95BudgetMs) throw new Error(`Write p95 exceeded ${writeP95BudgetMs}ms budget.`);
