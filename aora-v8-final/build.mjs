import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = resolve(root, "../aora");
const overlay = resolve(root, "overlay");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await cp(overlay, output, {
  recursive: true,
  filter: (entry) => !entry.endsWith("/styles.css") && !entry.endsWith("\\styles.css"),
});

const originalCss = await readFile(resolve(source, "styles.css"), "utf8");
const extensionCss = await readFile(resolve(overlay, "styles.css"), "utf8");
await writeFile(resolve(output, "styles.css"), `${originalCss}\n\n${extensionCss}\n`, "utf8");

const index = await readFile(resolve(output, "index.html"), "utf8");
for (const route of ["inhaber", "arbeitgeber", "arbeitnehmer", "kiosk/dashboard"]) {
  const directory = resolve(output, route);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "index.html"), index, "utf8");
}

console.log("Aora V8 Final built without modifying ../aora");
