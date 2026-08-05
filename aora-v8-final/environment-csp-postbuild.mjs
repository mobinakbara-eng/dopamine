import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const output=resolve(root,"dist");
const stagingProjectRef="xqgkawskftzurbujrpex";
const productionProjectRef="lxpmgnllgqdulfjxbdau";
const environment=String(process.env.AORA_DEPLOY_ENV||process.env.VERCEL_ENV||"development").trim();
const production=environment==="production";
const expectedProjectRef=production?productionProjectRef:stagingProjectRef;
const runtimeSource=await readFile(resolve(output,"runtime-config.js"),"utf8");
const match=runtimeSource.match(/"supabaseUrl":"(https:\/\/[^"/]+\.supabase\.co)"/);
if(!match)throw new Error("Environment CSP build blocked: Supabase runtime URL was not found.");
const supabaseUrl=new URL(match[1]);
const runtimeProjectRef=supabaseUrl.hostname.split(".")[0];
if(runtimeProjectRef!==expectedProjectRef){
  throw new Error(`Environment CSP build blocked: ${environment} artifact targets unexpected Supabase project ${runtimeProjectRef}.`);
}

const appPolicy=`connect-src 'self' https://${runtimeProjectRef}.supabase.co wss://${runtimeProjectRef}.supabase.co`;
const privacyPolicy="connect-src 'none'";
const marker="data-aora-environment-csp";
const privacyRoutes=new Set(["datenschutz/index.html","datenschutzbeauftragter/index.html"]);

async function htmlFiles(directory){
  const entries=await readdir(directory,{withFileTypes:true});
  const files=[];
  for(const entry of entries){
    const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...await htmlFiles(path));
    else if(extname(entry.name).toLowerCase()===".html")files.push(path);
  }
  return files;
}
function artifactPath(path){return relative(output,path).split(sep).join("/")}
function meta(policy){return `<meta http-equiv="Content-Security-Policy" ${marker} content="${policy}">`}

const files=await htmlFiles(output);
if(!files.length)throw new Error("Environment CSP build blocked: no HTML artifacts were generated.");
let privacyCount=0;
for(const path of files){
  const source=await readFile(path,"utf8");
  const withoutPrevious=source.replace(/\s*<meta[^>]*data-aora-environment-csp[^>]*>/gi,"");
  if(!/<head(?:\s[^>]*)?>/i.test(withoutPrevious))throw new Error(`Environment CSP build blocked: ${path} has no <head>.`);
  const isPrivacy=privacyRoutes.has(artifactPath(path));
  const policy=isPrivacy?privacyPolicy:appPolicy;
  if(isPrivacy)privacyCount+=1;
  const hardened=withoutPrevious.replace(/<head(\s[^>]*)?>/i,head=>`${head}\n  ${meta(policy)}`);
  await writeFile(path,hardened,"utf8");
}
if(privacyCount!==privacyRoutes.size)throw new Error("Environment CSP build blocked: privacy artifacts are incomplete.");
await writeFile(resolve(output,"environment-csp.txt"),`${appPolicy}\n`,"utf8");
console.log(`Environment CSP applied to ${files.length-privacyCount} app and ${privacyCount} privacy artifacts for ${environment} (${runtimeProjectRef}).`);
