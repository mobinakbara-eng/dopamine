import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
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

const policy=`connect-src 'self' https://${runtimeProjectRef}.supabase.co wss://${runtimeProjectRef}.supabase.co`;
const marker="data-aora-environment-csp";
const meta=`<meta http-equiv="Content-Security-Policy" ${marker} content="${policy}">`;

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

const files=await htmlFiles(output);
if(!files.length)throw new Error("Environment CSP build blocked: no HTML artifacts were generated.");
for(const path of files){
  const source=await readFile(path,"utf8");
  const withoutPrevious=source.replace(/\s*<meta[^>]*data-aora-environment-csp[^>]*>/gi,"");
  if(!/<head(?:\s[^>]*)?>/i.test(withoutPrevious))throw new Error(`Environment CSP build blocked: ${path} has no <head>.`);
  const hardened=withoutPrevious.replace(/<head(\s[^>]*)?>/i,match=>`${match}\n  ${meta}`);
  await writeFile(path,hardened,"utf8");
}
await writeFile(resolve(output,"environment-csp.txt"),`${policy}\n`,"utf8");
console.log(`Environment CSP applied to ${files.length} HTML artifacts for ${environment} (${runtimeProjectRef}).`);
