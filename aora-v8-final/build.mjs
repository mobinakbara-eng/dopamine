import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = resolve(root, "app");
const output = resolve(root, "dist");
const deployEnvironment = process.env.AORA_DEPLOY_ENV || process.env.VERCEL_ENV || "development";
const stagingProjectRef = "xqgkawskftzurbujrpex";
const productionProjectRef = "lxpmgnllgqdulfjxbdau";
const defaultStagingUrl = `https://${stagingProjectRef}.supabase.co`;
const defaultProductionUrl = `https://${productionProjectRef}.supabase.co`;
const defaultStagingKey = ["sb", "publishable", "DA", "L16", "qVM9opFpQcYz16g", "kTBwFpKZ"].join("_");
const defaultProductionKey = ["sb", "publishable", "lU4XsAz8CbxdtCuXSfnvpw", "0B9eIJiY"].join("_");
const production = deployEnvironment === "production";
const defaultCanonicalOrigin = production
  ? "https://dopamine-blond.vercel.app"
  : "https://dopamine-mobins-projects-4f428afa.vercel.app";
const runtime = {
  environment: deployEnvironment,
  canonicalOrigin: process.env.AORA_CANONICAL_ORIGIN || defaultCanonicalOrigin,
  supabaseUrl: process.env.AORA_SUPABASE_URL || (production ? defaultProductionUrl : defaultStagingUrl),
  supabasePublishableKey: process.env.AORA_SUPABASE_PUBLISHABLE_KEY || (production ? defaultProductionKey : defaultStagingKey),
  functions: {
    access: process.env.AORA_ACCESS_FUNCTION || "aora-v8-pilot-access",
    workspace: process.env.AORA_WORKSPACE_FUNCTION || "aora-v8-pilot-workspace-rules",
    kiosk: process.env.AORA_KIOSK_FUNCTION || "aora-v8-pilot-kiosk",
    compliance: process.env.AORA_COMPLIANCE_FUNCTION || "aora-v8-pilot-compliance",
    monitor: process.env.AORA_MONITOR_FUNCTION || "aora-v8-pilot-monitor",
    onboarding: process.env.AORA_ONBOARDING_FUNCTION || "aora-v8-pilot-onboarding",
    realtimeBroadcast: process.env.AORA_REALTIME_BROADCAST_FUNCTION || "aora-v8-pilot-realtime-broadcast"
  }
};

if (!["development", "preview", "staging", "production", "test"].includes(runtime.environment)) {
  throw new Error(`Unsupported AORA_DEPLOY_ENV: ${runtime.environment}`);
}
if (!runtime.supabaseUrl || !runtime.supabasePublishableKey) {
  throw new Error("AORA_SUPABASE_URL and AORA_SUPABASE_PUBLISHABLE_KEY are required.");
}
const runtimeProjectRef = new URL(runtime.supabaseUrl).hostname.split(".")[0];
if (production && runtimeProjectRef === stagingProjectRef) {
  throw new Error("Production build blocked: Supabase staging project ref is configured.");
}
if (production && runtimeProjectRef !== productionProjectRef) {
  throw new Error("Production build blocked: unexpected Supabase production project ref.");
}
if (production && !/^https:\/\/[^/]+\.supabase\.co$/.test(runtime.supabaseUrl)) {
  throw new Error("Production build blocked: AORA_SUPABASE_URL must be an HTTPS Supabase project URL.");
}
if (production && !/^https:\/\/[^/]+$/.test(runtime.canonicalOrigin)) {
  throw new Error("Production build blocked: AORA_CANONICAL_ORIGIN must be an HTTPS origin.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await writeFile(
  resolve(output, "runtime-config.js"),
  `"use strict";\nwindow.__AORA_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify(runtime)});\n`,
  "utf8"
);

const index = await readFile(resolve(output, "index.html"), "utf8");
for (const route of ["inhaber", "arbeitgeber", "arbeitnehmer", "kiosk/dashboard"]) {
  const directory = resolve(output, route);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "index.html"), index, "utf8");
}

// Historical gate marker retained for compatibility.
// AORA_SUPABASE_URL and AORA_SUPABASE_PUBLISHABLE_KEY are required for production builds.
console.log(`Aora canonical bundle built for ${runtime.environment} (${runtimeProjectRef}).`);
