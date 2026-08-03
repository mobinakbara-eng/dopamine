import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const dist=resolve(root,"dist");
const exists=async path=>access(resolve(dist,path)).catch(()=>{throw new Error(`Missing post-build asset: ${path}`)});
const read=path=>readFile(resolve(dist,path),"utf8");
const requireAll=(name,text,markers)=>{for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing built ${name} marker: ${marker}`)};
const forbidAll=(name,text,markers)=>{for(const marker of markers)if(text.includes(marker))throw new Error(`Forbidden built ${name} marker: ${marker}`)};

for(const path of [
  "timesheet-document-signing.css",
  "modules/timesheet-document-signing.js",
  "datenschutz/index.html",
  "datenschutzbeauftragter/index.html"
])await exists(path);

const [index,signing,privacy,dpo]=await Promise.all([
  read("index.html"),
  read("modules/timesheet-document-signing.js"),
  read("datenschutz/index.html"),
  read("datenschutzbeauftragter/index.html")
]);
requireAll("app shell",index,["timesheet-document-signing.css?v=833","modules/timesheet-document-signing.js?v=833"]);
requireAll("document signing",signing,["PDF ohne Unterschrift","Bestätigung & Unterschrift anfordern","Bestätigen & unterschreiben","aora-v8-timesheet-document-signing"]);
for(const [name,page] of [["privacy",privacy],["DPO",dpo]]){
  requireAll(name,page,[
    "(Name des verantwortlichen Arbeitgebers eintragen)",
    "(Rechtlichen Namen des Plattformbetreibers eintragen)",
    "(Name der bestellten Person eintragen)",
    "(E-Mail-Adresse des Datenschutzbeauftragten eintragen)"
  ]);
  forbidAll(name,page,["{{","Ihr Arbeitgeber / Betreiber des Aora-Arbeitsbereichs","<script","fonts.googleapis.com","supabase.co"]);
}
if(privacy!==dpo)throw new Error("Privacy route aliases must render the same legal contact document.");
console.log("Post-build contract passed: explicit legal placeholders and document-scoped signing assets are present.");
