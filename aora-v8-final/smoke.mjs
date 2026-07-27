import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");

async function exists(relativePath) {
  await access(resolve(dist, relativePath)).catch(() => {
    throw new Error(`Missing built asset: ${relativePath}`);
  });
}

for (const relativePath of [
  "index.html",
  "styles.css",
  "invitation.css",
  "modules/config.js",
  "modules/api.js",
  "modules/access.js",
  "modules/handlers.js",
  "modules/boot.js",
  "inhaber/index.html",
  "arbeitgeber/index.html",
  "arbeitnehmer/index.html",
  "kiosk/dashboard/index.html",
]) {
  await exists(relativePath);
}

const rootIndex = await readFile(resolve(dist, "index.html"), "utf8");
for (const marker of [
  "AoraAI Workforce",
  "styles.css?v=807",
  "invitation.css?v=807",
  "modules/config.js?v=807",
  "modules/api.js?v=807",
  "modules/handlers.js?v=807",
  "modules/boot.js?v=807",
]) {
  if (!rootIndex.includes(marker)) throw new Error(`Missing built index marker: ${marker}`);
}

for (const route of ["inhaber", "arbeitgeber", "arbeitnehmer", "kiosk/dashboard"]) {
  const routeIndex = await readFile(resolve(dist, route, "index.html"), "utf8");
  if (routeIndex !== rootIndex) throw new Error(`Route shell differs from canonical build: ${route}`);
}

const config = await readFile(resolve(dist, "modules/config.js"), "utf8");
for (const marker of [
  'slug:"aora-v8-hardening-demo"',
  'accessFunction:"aora-v8-hardening-access"',
  'workspaceFunction:"aora-v8-hardening-workspace"',
  'version:"8.0.7-hardening"',
]) {
  if (!config.includes(marker)) throw new Error(`Missing built hardening marker: ${marker}`);
}
for (const forbidden of [
  'slug:"aora-v8-final-demo"',
  'accessFunction:"aora-v8-final-access"',
  'workspaceFunction:"aora-v8-final-workspace"',
]) {
  if (config.includes(forbidden)) throw new Error(`Built output points to old service: ${forbidden}`);
}

const css = await readFile(resolve(dist, "styles.css"), "utf8");
for (const marker of [
  "--black:#000",
  "--white:#fff",
  "--radius:16px",
  '--font:"Manrope",Arial,sans-serif',
  '--display:"Sora","Manrope",sans-serif',
  ".owner-hero",
]) {
  if (!css.includes(marker)) throw new Error(`Missing built visual marker: ${marker}`);
}

const modulesDirectory = resolve(dist, "modules");
const modules = (await readdir(modulesDirectory)).filter((file) => file.endsWith(".js")).sort();
if (modules.length < 9) throw new Error(`Unexpected built module count: ${modules.length}`);
for (const module of modules) {
  execFileSync(process.execPath, ["--check", resolve(modulesDirectory, module)], { stdio: "inherit" });
}

console.log(
  `Aora post-build smoke checks passed (${modules.length} modules, 4 role routes, hardening services, visual markers).`,
);
