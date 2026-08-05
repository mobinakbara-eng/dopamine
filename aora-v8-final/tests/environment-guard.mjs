import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const node=(script,env)=>spawnSync(process.execPath,[resolve(root,script)],{cwd:root,encoding:"utf8",env});
const run=overrides=>{
  const env={...process.env,...overrides};
  const build=node("build.mjs",env);
  if(build.status!==0)return build;
  const csp=node("environment-csp-postbuild.mjs",env);
  return{
    status:csp.status,
    stdout:`${build.stdout||""}${csp.stdout||""}`,
    stderr:`${build.stderr||""}${csp.stderr||""}`
  };
};
const readArtifact=path=>readFileSync(resolve(root,"dist",path),"utf8");
const assertArtifact=(environment,expectedRef,rejectedRef)=>{
  const runtimeConfig=readArtifact("runtime-config.js");
  const policy=readArtifact("environment-csp.txt").trim();
  const employerHtml=readArtifact("arbeitgeber/index.html");
  const expectedPolicy=`connect-src 'self' https://${expectedRef}.supabase.co wss://${expectedRef}.supabase.co`;
  if(!runtimeConfig.includes(expectedRef)||runtimeConfig.includes(rejectedRef)){
    throw new Error(`${environment} runtime config must target only its assigned Supabase project.`);
  }
  if(policy!==expectedPolicy){
    throw new Error(`${environment} environment CSP does not match its assigned Supabase project.`);
  }
  if(!employerHtml.includes("data-aora-environment-csp")||!employerHtml.includes(expectedPolicy)||employerHtml.includes(rejectedRef)){
    throw new Error(`${environment} employer artifact must allow connections only to its assigned Supabase project.`);
  }
};

const production=run({
  AORA_DEPLOY_ENV:"production",
  AORA_SUPABASE_URL:"",
  AORA_SUPABASE_PUBLISHABLE_KEY:""
});
if(production.status!==0){
  throw new Error(`Production build must use the locked production defaults.\n${production.stdout}\n${production.stderr}`);
}
assertArtifact("Production","lxpmgnllgqdulfjxbdau","xqgkawskftzurbujrpex");

const blocked=run({
  AORA_DEPLOY_ENV:"production",
  AORA_SUPABASE_URL:"https://xqgkawskftzurbujrpex.supabase.co",
  AORA_SUPABASE_PUBLISHABLE_KEY:"test-only"
});
if(blocked.status===0||!`${blocked.stdout}\n${blocked.stderr}`.includes("Supabase staging project ref is configured")){
  throw new Error("Production build must reject the staging Supabase project.");
}

const staging=run({
  AORA_DEPLOY_ENV:"staging",
  AORA_SUPABASE_URL:"",
  AORA_SUPABASE_PUBLISHABLE_KEY:""
});
if(staging.status!==0){
  throw new Error(`Staging build must use the locked staging defaults.\n${staging.stdout}\n${staging.stderr}`);
}
assertArtifact("Staging","xqgkawskftzurbujrpex","lxpmgnllgqdulfjxbdau");

console.log("Environment guard passed: production and staging artifacts have isolated runtime configuration and connect-src policies.");
