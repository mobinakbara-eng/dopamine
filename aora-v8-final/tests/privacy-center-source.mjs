import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [template,css,links,index,build]=await Promise.all([
  read("app/privacy-page.template.html"),
  read("app/privacy-page.css"),
  read("app/modules/legal-links.js"),
  read("app/index.html"),
  read("build.mjs")
]);
const requireAll=(name,text,markers)=>{for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`)};
const forbidAll=(name,text,markers)=>{for(const marker of markers)if(text.includes(marker))throw new Error(`Forbidden ${name} marker: ${marker}`)};

requireAll("privacy page",template,[
  "Ihre Daten. Ihre Rechte.",
  "Ihr Arbeitgeber ist grundsätzlich Verantwortlicher",
  "Diese Seite setzt keine Cookies",
  "Art. 15",
  "Art. 16",
  "Art. 17",
  "Art. 18",
  "Art. 20",
  "Art. 21",
  "grundsätzlich innerhalb eines Monats",
  "Berliner Beauftragte für Datenschutz und Informationsfreiheit",
  "{{CONTACT_TITLE}}",
  "{{CONTACT_DETAILS}}"
]);
forbidAll("privacy page",template,["<form","fonts.googleapis.com","cdn.jsdelivr.net","supabase","google-analytics","gtag(","GTM-"]);
requireAll("privacy CSS",css,[".privacy-status.pending",".privacy-contact-layout","prefers-reduced-motion",".rights-grid"]);
requireAll("legal navigation",links,["MutationObserver","/datenschutz/","/datenschutzbeauftragter/","data-aora-employee-privacy","data-aora-sidebar-privacy"]);
requireAll("app shell",index,["legal-links.css?v=832","modules/legal-links.js?v=832"]);
requireAll("privacy build",build,[
  "AORA_DPO_APPOINTED",
  "AORA_DPO_EMAIL",
  "AORA_PRIVACY_OPERATOR_LEGAL_NAME",
  "AORA_PRIVACY_EMAIL",
  'for (const route of ["datenschutz", "datenschutzbeauftragter"])',
  "AORA_DPO_APPOINTED requires at least one public DPO contact channel",
  "privacy-page.template.html",
  "privacy-contact"
]);
forbidAll("privacy defaults",build,["datenschutz@aora", "privacy@aora", "Datenschutzbeauftragter: Amin", "Datenschutzbeauftragter: Mobin"]);
console.log("Privacy center source contract passed: standalone, data-minimal, configurable and non-deceptive DPO presentation.");
