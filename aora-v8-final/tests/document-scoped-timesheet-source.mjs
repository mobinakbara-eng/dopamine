import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,ui,css,edge,migration]=await Promise.all([
  read("app/index.html"),
  read("app/modules/timesheet-document-signing.js"),
  read("app/timesheet-document-signing.css"),
  read("supabase/functions/aora-v8-timesheet-document-signing/index.ts"),
  read("supabase/migrations/202608040130_aora_document_scoped_timesheet_signatures.sql")
]);
const requireAll=(name,text,markers)=>{for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`)};
const forbidAll=(name,text,markers)=>{for(const marker of markers)if(text.includes(marker))throw new Error(`Forbidden ${name} marker: ${marker}`)};

requireAll("app shell",index,["timesheet-document-signing.css?v=833","modules/timesheet-document-signing.js?v=833"]);
requireAll("manager and employee workflow",ui,[
  "Aktuelle Zeiten laden",
  "PDF ohne Unterschrift",
  "Bestätigung & Unterschrift anfordern",
  "Bestätigen & unterschreiben",
  "Korrektur anfordern",
  'call("prepareTimesheet"',
  'action:"exportTimesheet"',
  "consentAccepted",
  "signatureDataUrl",
  "Diese Zeichnung wird nicht als allgemeine Unterschrift gespeichert"
]);
requireAll("responsive signing UI",css,[".docsign-signature-consent",".docsign-signature-box",".docsign-document-table","@media(max-width:650px)"]);
requireAll("document-scoped edge workflow",edge,[
  'const CONSENT_TEXT =',
  'action === "prepareTimesheet"',
  'action === "requestApproval"',
  'action === "decideTimesheet"',
  'action === "exportTimesheet"',
  'body.signed === true',
  "timesheet_document_signatures",
  "document_signature_id",
  "UNBESTAETIGTE VERSION - OHNE MITARBEITERUNTERSCHRIFT",
  "BESTAETIGTE VERSION MIT MITARBEITERUNTERSCHRIFT",
  "Die Unterschrift darf nicht für andere oder zukünftige Dokumente wiederverwendet werden"
]);
forbidAll("new edge reusable-signature dependency",edge,["activeSignature(","hasActiveRequiredRecords(","employee_document_consents","sendConsentRequest","revokeSignatureConsent"]);
requireAll("database isolation",migration,[
  "timesheet_document_signatures",
  "submission_version",
  "consent_text",
  "signed_hash",
  "unsigned_export_checksum",
  "document_signature_id",
  "enable row level security",
  "revoke all on public.timesheet_document_signatures from anon, authenticated"
]);
console.log("Document-scoped timesheet signing source contract passed: unsigned preview, explicit request, one-time signature, immutable signed export.");
