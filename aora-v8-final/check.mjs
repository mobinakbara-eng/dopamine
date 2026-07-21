import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const modules=resolve(root,"overlay/modules");
const files=(await readdir(modules)).filter(file=>file.endsWith(".js")).sort();
if(!files.length)throw new Error("No overlay JavaScript modules found.");
for(const file of files){
  execFileSync(process.execPath,["--check",resolve(modules,file)],{stdio:"inherit"});
}
for(const file of ["package.json","vercel.json"]){
  JSON.parse(await readFile(resolve(root,file),"utf8"));
}
const index=await readFile(resolve(root,"overlay/index.html"),"utf8");
for(const module of ["config.js","api.js","access.js","admin.js","owner-routing.js","modals.js","handlers.js","boot.js"]){
  if(!index.includes(`modules/${module}`))throw new Error(`Missing script in overlay index: ${module}`);
}
const config=await readFile(resolve(modules,"config.js"),"utf8");
for(const expected of ["aora-v8-final-demo","aora-v8-final-access","aora-v8-final-workspace","8.0.5-final"]){
  if(!config.includes(expected))throw new Error(`Missing isolated config marker: ${expected}`);
}
console.log(`Aora V8 Final checks passed (${files.length} JavaScript modules).`);
