import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const dist=resolve(root,"dist");
const pages=["index.html","inhaber/index.html","arbeitgeber/index.html","arbeitnehmer/index.html","kiosk/dashboard/index.html","reset-password/index.html"];
for(const page of pages){
  const path=resolve(dist,page);
  let html=await readFile(path,"utf8");
  html=html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/gi,"");
  html=html.replace('<link rel="manifest" href="/manifest.webmanifest">','<link rel="apple-touch-icon" sizes="180x180" href="/aora-app-icon-180.png?v=4">\n<link rel="manifest" href="/manifest.webmanifest?v=4">');
  if(!html.includes("push-notifications.css"))html=html.replace("</head>",'<link rel="stylesheet" href="/push-notifications.css?v=852">\n</head>');
  if(!html.includes("modules/push-notifications.js"))html=html.replace('<script src="modules/handlers.js?v=822" defer></script>','<script src="modules/push-notifications.js?v=852" defer></script>\n<script src="modules/employee-kiosk-policy.js?v=853" defer></script>\n<script src="modules/handlers.js?v=822" defer></script>');
  await writeFile(path,html,"utf8");
}
console.log("Aora mobile assets and employee policy injected.");
