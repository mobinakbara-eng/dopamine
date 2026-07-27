import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const modules = resolve(root, "overlay/modules");
const files = (await readdir(modules)).filter((file) => file.endsWith(".js")).sort();

if (!files.length) throw new Error("No overlay JavaScript modules found.");
for (const file of files) {
  execFileSync(process.execPath, ["--check", resolve(modules, file)], { stdio: "inherit" });
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));

const requiredPaths = [
  "supabase/functions/aora-v8-hardening-access/index.ts",
  "supabase/functions/aora-v8-hardening-workspace/index.ts",
  "supabase/functions/aora-v8-hardening-kiosk/index.ts",
  "supabase/migrations/202607270001_aora_hardening_atomic_rate_limit.sql",
  "supabase/migrations/202607270002_aora_hardening_atomic_invitation_accept.sql",
  "supabase/migrations/202607270003_aora_hardening_atomic_projection_trigger.sql",
];
for (const relativePath of requiredPaths) {
  await access(resolve(root, relativePath)).catch(() => {
    throw new Error(`Missing hardening source: ${relativePath}`);
  });
}

const index = await readFile(resolve(root, "overlay/index.html"), "utf8");
for (const module of [
  "config.js",
  "api.js",
  "access.js",
  "admin.js",
  "owner-routing.js",
  "kiosk-hardening.js",
  "modals.js",
  "invitation-delivery.js",
  "handlers.js",
  "boot.js",
]) {
  if (!index.includes(`modules/${module}`)) {
    throw new Error(`Missing script in overlay index: ${module}`);
  }
}
if (!index.includes("invitation.css")) throw new Error("Missing invitation stylesheet.");
for (const marker of ["styles.css?v=808", "config.js?v=808", "kiosk-hardening.js?v=808"]) {
  if (!index.includes(marker)) throw new Error(`Missing 8.0.8 cache marker: ${marker}`);
}

const config = await readFile(resolve(modules, "config.js"), "utf8");
for (const expected of [
  "aora-v8-hardening-demo",
  "aora-v8-hardening-access",
  "aora-v8-hardening-workspace",
  "aora-v8-hardening-kiosk",
  "8.0.8-hardening",
]) {
  if (!config.includes(expected)) throw new Error(`Missing isolated config marker: ${expected}`);
}

const configuredVersion = config.match(/version:\s*"([^"]+)"/)?.[1];
if (!configuredVersion || packageJson.version !== configuredVersion) {
  throw new Error(
    `Version mismatch: package.json=${packageJson.version}, config.js=${configuredVersion || "missing"}`,
  );
}

const apiSource = await readFile(resolve(modules, "api.js"), "utf8");
const bootSource = await readFile(resolve(modules, "boot.js"), "utf8");
const handlersSource = await readFile(resolve(modules, "handlers.js"), "utf8");
const invitationSource = await readFile(resolve(modules, "invitation-delivery.js"), "utf8");
const kioskOverlay = await readFile(resolve(modules, "kiosk-hardening.js"), "utf8");
const canonicalKiosk = await readFile(resolve(root, "../aora/modules/kiosk-view.js"), "utf8");
const accessFunction = await readFile(
  resolve(root, "supabase/functions/aora-v8-hardening-access/index.ts"),
  "utf8",
);
const workspaceFunction = await readFile(
  resolve(root, "supabase/functions/aora-v8-hardening-workspace/index.ts"),
  "utf8",
);
const kioskFunction = await readFile(
  resolve(root, "supabase/functions/aora-v8-hardening-kiosk/index.ts"),
  "utf8",
);
const projectionMigration = await readFile(
  resolve(root, "supabase/migrations/202607270003_aora_hardening_atomic_projection_trigger.sql"),
  "utf8",
);

for (const marker of [
  "`aora:${CFG.slug}:${accessRole}`",
  "cache:\"no-store\"",
  "ensureDirectory",
  "REQUEST_TIMEOUT_MS",
  "AbortController",
  "Eine Aktion wird bereits verarbeitet",
  "S.directory=null",
  'S.accessRole==="kiosk"?CFG.kioskWorkspaceFunction:CFG.workspaceFunction',
]) {
  if (!apiSource.includes(marker)) throw new Error(`Missing frontend hardening marker: ${marker}`);
}
if (!bootSource.includes("await ensureDirectory(accessRole)")) {
  throw new Error("Boot must lazy-load the public PIN directory only when required.");
}
for (const marker of ["managerInvitationModal()", "employeeInvitationModal()"]) {
  if (!handlersSource.includes(marker)) throw new Error(`Missing explicit invitation handler: ${marker}`);
}
for (const marker of [
  "function managerInvitationModal()",
  "function employeeInvitationModal()",
  "submit.disabled=true",
  "invitationDeliveryModal(result.delivery)",
]) {
  if (!invitationSource.includes(marker)) throw new Error(`Missing invitation lifecycle marker: ${marker}`);
}
for (const forbidden of ["function managerModal()", "function employeeAccountModal()"]) {
  if (invitationSource.includes(forbidden)) {
    throw new Error(`Invitation module must not override base modal function: ${forbidden}`);
  }
}
for (const marker of [
  'employee.status!=="pending"',
  'employee.status!=="revoked"',
  "function renderKiosk()",
]) {
  if (!kioskOverlay.includes(marker)) throw new Error(`Missing kiosk overlay marker: ${marker}`);
}
if (canonicalKiosk.includes('status!=="pending"') || canonicalKiosk.includes("aora-v8-hardening")) {
  throw new Error("Canonical aora kiosk source was modified by the hardening overlay.");
}
for (const marker of [
  "aora_hardening_project_snapshot_trigger",
  "aora-v8-hardening-demo",
  "after update of state",
  "project_workspace_state",
  "revoke all",
  "service_role",
]) {
  if (!projectionMigration.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`Missing atomic projection migration marker: ${marker}`);
  }
}
for (const marker of [
  "aora_consume_rate_limit",
  "aora_accept_invitation_atomic",
  "MAX_BODY_BYTES",
  "Origin not allowed",
  "TEAM_PREVIEW_SUFFIX",
]) {
  if (!accessFunction.includes(marker)) throw new Error(`Missing access hardening marker: ${marker}`);
}
for (const marker of [
  'timesheetPeriods: []',
  'event?.type !== "KIOSK_TRANSITION"',
  'type: "REQUEST_CLOCK"',
  'target = "resume"',
  "MANAGER_LEGACY_TYPES",
  "MAX_BODY_BYTES",
  "TEAM_PREVIEW_SUFFIX",
]) {
  if (!workspaceFunction.includes(marker)) throw new Error(`Missing workspace hardening marker: ${marker}`);
}
for (const marker of [
  'session.role !== "kiosk"',
  'device.locked === true',
  'item.status !== "pending"',
  'item.status !== "revoked"',
  "new TextEncoder().encode(text).byteLength",
  "KIOSK_TARGETS",
  "Dieser Statuswechsel ist aktuell nicht möglich",
  "UPSTREAM_TIMEOUT_MS",
]) {
  if (!kioskFunction.includes(marker)) throw new Error(`Missing kiosk guard marker: ${marker}`);
}

const baseCss = await readFile(resolve(root, "../aora/styles.css"), "utf8");
const overlayCss = await readFile(resolve(root, "overlay/styles.css"), "utf8");
const buildScript = await readFile(resolve(root, "build.mjs"), "utf8");

for (const marker of [
  "--black:#000",
  "--white:#fff",
  "--radius:16px",
  '--font:"Manrope",Arial,sans-serif',
  '--display:"Sora","Manrope",sans-serif',
  ".aora-logo",
]) {
  if (!baseCss.includes(marker)) throw new Error(`Canonical design marker changed or missing: ${marker}`);
}

for (const forbidden of [
  /(^|})\s*:root\s*{/m,
  /(^|})\s*html\s*[{,]/m,
  /(^|})\s*body\s*[{,]/m,
  /(^|})\s*\*\s*{/m,
  /(^|})\s*\.aora-logo\s*{/m,
]) {
  if (forbidden.test(overlayCss)) {
    throw new Error(`Overlay attempts to replace a canonical visual-identity selector: ${forbidden}`);
  }
}

if (!buildScript.includes('`${originalCss}\\n\\n${extensionCss}\\n`')) {
  throw new Error("Build must preserve canonical CSS first and append the isolated overlay second.");
}

console.log(
  `Aora hardening checks passed (${files.length} JavaScript modules, version ${configuredVersion}, visual identity locked).`,
);
