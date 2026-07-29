import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const run=overrides=>spawnSync(process.execPath,[resolve(root,"build.mjs")],{
  cwd:root,
  encoding:"utf8",
  env:{...process.env,...overrides}
});

const missing=run({
  AORA_DEPLOY_ENV:"production",
  AORA_SUPABASE_URL:"",
  AORA_SUPABASE_PUBLISHABLE_KEY:""
});
if(missing.status===0||!`${missing.stdout}\n${missing.stderr}`.includes("AORA_SUPABASE_URL and AORA_SUPABASE_PUBLISHABLE_KEY are required")){
  throw new Error("Production build must reject missing Supabase configuration.");
}

const staging=run({
  AORA_DEPLOY_ENV:"production",
  AORA_SUPABASE_URL:"https://xqgkawskftzurbujrpex.supabase.co",
  AORA_SUPABASE_PUBLISHABLE_KEY:"test-only"
});
if(staging.status===0||!`${staging.stdout}\n${staging.stderr}`.includes("Supabase staging project ref is configured")){
  throw new Error("Production build must reject the staging Supabase project.");
}

console.log("Environment guard test passed: production rejects missing credentials and the staging project ref.");
