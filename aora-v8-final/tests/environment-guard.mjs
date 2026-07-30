import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const run=overrides=>spawnSync(process.execPath,[resolve(root,"build.mjs")],{
  cwd:root,
  encoding:"utf8",
  env:{...process.env,...overrides}
});

const production=run({
  AORA_DEPLOY_ENV:"production",
  AORA_SUPABASE_URL:"",
  AORA_SUPABASE_PUBLISHABLE_KEY:""
});
if(production.status!==0){
  throw new Error(`Production build must use the locked production defaults.\n${production.stdout}\n${production.stderr}`);
}
const runtimeConfig=readFileSync(resolve(root,"dist/runtime-config.js"),"utf8");
if(!runtimeConfig.includes("lxpmgnllgqdulfjxbdau")||runtimeConfig.includes("xqgkawskftzurbujrpex")){
  throw new Error("Production runtime config must target only the production Supabase project.");
}

const staging=run({
  AORA_DEPLOY_ENV:"production",
  AORA_SUPABASE_URL:"https://xqgkawskftzurbujrpex.supabase.co",
  AORA_SUPABASE_PUBLISHABLE_KEY:"test-only"
});
if(staging.status===0||!`${staging.stdout}\n${staging.stderr}`.includes("Supabase staging project ref is configured")){
  throw new Error("Production build must reject the staging Supabase project.");
}

console.log("Environment guard test passed: production uses the locked production runtime and rejects staging.");
