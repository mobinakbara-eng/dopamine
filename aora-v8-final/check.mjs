import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
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

const index = await readFile(resolve(root, "overlay/index.html"), "utf8");
for (const module of [
  "config.js",
  "api.js",
  "access.js",
  "admin.js",
  "owner-routing.js",
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

const config = await readFile(resolve(modules, "config.js"), "utf8");
for (const expected of [
  "aora-v8-final-demo",
  "aora-v8-final-access",
  "aora-v8-final-workspace",
  "8.0.6-final",
]) {
  if (!config.includes(expected)) throw new Error(`Missing isolated config marker: ${expected}`);
}

const configuredVersion = config.match(/version:\s*"([^"]+)"/)?.[1];
if (!configuredVersion || packageJson.version !== configuredVersion) {
  throw new Error(
    `Version mismatch: package.json=${packageJson.version}, config.js=${configuredVersion || "missing"}`,
  );
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
  `Aora V8 Final checks passed (${files.length} JavaScript modules, version ${configuredVersion}, visual identity locked).`,
);
