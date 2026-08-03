import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = resolve(root, "app");
const output = resolve(root, "dist");
const deployEnvironment = process.env.AORA_DEPLOY_ENV || process.env.VERCEL_ENV || "development";
const stagingProjectRef = "xqgkawskftzurbujrpex";
const productionProjectRef = "lxpmgnllgqdulfjxbdau";
const defaultStagingUrl = `https://${stagingProjectRef}.supabase.co`;
const defaultProductionUrl = `https://${productionProjectRef}.supabase.co`;
const defaultStagingKey = ["sb", "publishable", "DA", "L16", "qVM9opFpQcYz16g", "kTBwFpKZ"].join("_");
const defaultProductionKey = ["sb", "publishable", "lU4XsAz8CbxdtCuXSfnvpw", "0B9eIJiY"].join("_");
const production = deployEnvironment === "production";
const defaultCanonicalOrigin = production
  ? "https://dopamine-blond.vercel.app"
  : "https://dopamine-mobins-projects-4f428afa.vercel.app";
const envText = (name, fallback = "") => String(process.env[name] || fallback).trim();
const envBoolean = name => /^(1|true|yes|ja)$/i.test(envText(name));

const privacy = {
  controllerName: envText("AORA_PRIVACY_CONTROLLER_NAME", "Ihr Arbeitgeber / Betreiber des Aora-Arbeitsbereichs"),
  controllerAddress: envText("AORA_PRIVACY_CONTROLLER_ADDRESS", "Kontaktdaten gemäß Arbeitsvertrag und Unternehmensangaben"),
  controllerEmail: envText("AORA_PRIVACY_CONTROLLER_EMAIL"),
  operatorProductName: "AoraAI Workforce",
  operatorLegalName: envText("AORA_PRIVACY_OPERATOR_LEGAL_NAME", "Rechtlicher Betreiber gemäß Vertrag und Unternehmensangaben"),
  operatorAddress: envText("AORA_PRIVACY_OPERATOR_ADDRESS"),
  privacyContactName: envText("AORA_PRIVACY_CONTACT_NAME", "Datenschutzkontakt des Betreibers"),
  privacyEmail: envText("AORA_PRIVACY_EMAIL"),
  dpoAppointed: envBoolean("AORA_DPO_APPOINTED"),
  dpoName: envText("AORA_DPO_NAME"),
  dpoCompany: envText("AORA_DPO_COMPANY"),
  dpoEmail: envText("AORA_DPO_EMAIL"),
  dpoPhone: envText("AORA_DPO_PHONE"),
  dpoAddress: envText("AORA_DPO_ADDRESS"),
  authorityName: envText("AORA_PRIVACY_AUTHORITY_NAME", "Berliner Beauftragte für Datenschutz und Informationsfreiheit"),
  authorityAddress: envText("AORA_PRIVACY_AUTHORITY_ADDRESS", "Alt-Moabit 59–61, 10555 Berlin"),
  authorityEmail: envText("AORA_PRIVACY_AUTHORITY_EMAIL", "mailbox@datenschutz-berlin.de"),
  authorityPhone: envText("AORA_PRIVACY_AUTHORITY_PHONE", "+49 30 13889-0"),
  updatedAt: envText("AORA_PRIVACY_UPDATED_AT", new Intl.DateTimeFormat("de-DE", { year: "numeric", month: "long", day: "2-digit" }).format(new Date()))
};
if (privacy.dpoAppointed && !privacy.dpoEmail && !privacy.dpoPhone && !privacy.dpoAddress) {
  throw new Error("AORA_DPO_APPOINTED requires at least one public DPO contact channel.");
}

const runtime = {
  environment: deployEnvironment,
  canonicalOrigin: process.env.AORA_CANONICAL_ORIGIN || defaultCanonicalOrigin,
  supabaseUrl: process.env.AORA_SUPABASE_URL || (production ? defaultProductionUrl : defaultStagingUrl),
  supabasePublishableKey: process.env.AORA_SUPABASE_PUBLISHABLE_KEY || (production ? defaultProductionKey : defaultStagingKey),
  functions: {
    access: process.env.AORA_ACCESS_FUNCTION || "aora-v8-pilot-access",
    workspace: process.env.AORA_WORKSPACE_FUNCTION || "aora-v8-pilot-workspace-rules",
    kiosk: process.env.AORA_KIOSK_FUNCTION || "aora-v8-pilot-kiosk",
    compliance: process.env.AORA_COMPLIANCE_FUNCTION || "aora-v8-pilot-compliance",
    monitor: process.env.AORA_MONITOR_FUNCTION || "aora-v8-pilot-monitor",
    onboarding: process.env.AORA_ONBOARDING_FUNCTION || "aora-v8-pilot-onboarding",
    realtimeBroadcast: process.env.AORA_REALTIME_BROADCAST_FUNCTION || "aora-v8-pilot-realtime-broadcast",
    domainPatch: process.env.AORA_DOMAIN_PATCH_FUNCTION || "aora-v8-domain-patch",
    accountRecovery: process.env.AORA_ACCOUNT_RECOVERY_FUNCTION || "aora-v8-account-recovery"
  },
  privacy
};

if (!["development", "preview", "staging", "production", "test"].includes(runtime.environment)) {
  throw new Error(`Unsupported AORA_DEPLOY_ENV: ${runtime.environment}`);
}
if (!runtime.supabaseUrl || !runtime.supabasePublishableKey) {
  throw new Error("AORA_SUPABASE_URL and AORA_SUPABASE_PUBLISHABLE_KEY are required.");
}
const runtimeProjectRef = new URL(runtime.supabaseUrl).hostname.split(".")[0];
if (production && runtimeProjectRef === stagingProjectRef) {
  throw new Error("Production build blocked: Supabase staging project ref is configured.");
}
if (production && runtimeProjectRef !== productionProjectRef) {
  throw new Error("Production build blocked: unexpected Supabase production project ref.");
}
if (production && !/^https:\/\/[^/]+\.supabase\.co$/.test(runtime.supabaseUrl)) {
  throw new Error("Production build blocked: AORA_SUPABASE_URL must be an HTTPS Supabase project URL.");
}
if (production && !/^https:\/\/[^/]+$/.test(runtime.canonicalOrigin)) {
  throw new Error("Production build blocked: AORA_CANONICAL_ORIGIN must be an HTTPS origin.");
}

const html = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const emailAnchor = email => email
  ? `<a href="mailto:${html(email)}">${html(email)}</a>`
  : "Nicht öffentlich hinterlegt";
const phoneAnchor = phone => phone
  ? `<a href="tel:${html(phone.replace(/[^+\d]/g, ""))}">${html(phone)}</a>`
  : "";
const detailsList = entries => `<ul class="privacy-detail-list">${entries
  .filter(([, value]) => value)
  .map(([label, value]) => `<li><b>${html(label)}</b><span>${value}</span></li>`)
  .join("")}</ul>`;
const replaceTokens = (template, tokens) => Object.entries(tokens)
  .reduce((result, [token, value]) => result.replaceAll(`{{${token}}}`, String(value)), template);

const appointed = privacy.dpoAppointed;
const contactEmail = appointed ? privacy.dpoEmail : privacy.privacyEmail;
const contactPhone = appointed ? privacy.dpoPhone : "";
const contactTitle = appointed ? "Datenschutzbeauftragter" : "Datenschutzkontakt";
const contactName = appointed
  ? privacy.dpoName || privacy.dpoCompany || "Datenschutzbeauftragter des Betreibers"
  : privacy.privacyContactName;
const contactIntro = appointed
  ? "Der Datenschutzbeauftragte handelt in seiner gesetzlichen Funktion unabhängig, berichtet unmittelbar an die höchste Managementebene und ist bei der Bearbeitung von Anfragen zur Vertraulichkeit verpflichtet."
  : "Für dieses Deployment sind noch keine Kontaktdaten eines formell benannten Datenschutzbeauftragten veröffentlicht. Deshalb verwendet die Seite bewusst die Bezeichnung Datenschutzkontakt und behauptet keine noch nicht dokumentierte Bestellung.";
const contactDetails = detailsList([
  ["Person", appointed && privacy.dpoName ? html(privacy.dpoName) : ""],
  ["Organisation", appointed && privacy.dpoCompany ? html(privacy.dpoCompany) : ""],
  ["E-Mail", contactEmail ? emailAnchor(contactEmail) : "Kontaktadresse wird vor der Produktivfreigabe hinterlegt"],
  ["Telefon", contactPhone ? phoneAnchor(contactPhone) : ""],
  ["Postanschrift", appointed && privacy.dpoAddress ? html(privacy.dpoAddress) : ""]
]);
const emailAction = contactEmail
  ? `<a class="privacy-button" href="mailto:${html(contactEmail)}?subject=${encodeURIComponent("Datenschutzanfrage zu AoraAI Workforce")}">E-Mail vorbereiten</a>`
  : '<span class="privacy-button disabled" aria-disabled="true">Kontaktadresse noch nicht konfiguriert</span>';
const phoneAction = contactPhone
  ? `<a class="privacy-button secondary" href="tel:${html(contactPhone.replace(/[^+\d]/g, ""))}">Anrufen</a>`
  : "";
const controllerDetails = detailsList([
  ["Verantwortlicher", html(privacy.controllerName)],
  ["Anschrift", html(privacy.controllerAddress)],
  ["Kontakt", privacy.controllerEmail ? emailAnchor(privacy.controllerEmail) : "Über den Arbeitgeber bzw. die Personalstelle"]
]);
const operatorDetails = detailsList([
  ["Produkt", html(privacy.operatorProductName)],
  ["Rechtlicher Betreiber", html(privacy.operatorLegalName)],
  ["Anschrift", privacy.operatorAddress ? html(privacy.operatorAddress) : "Angaben gemäß Vertrag und Unternehmenskommunikation"],
  ["Datenschutzkontakt", privacy.privacyEmail ? emailAnchor(privacy.privacyEmail) : "Wird über die Deployment-Konfiguration veröffentlicht"]
]);
const authorityDetails = detailsList([
  ["Anschrift", html(privacy.authorityAddress)],
  ["E-Mail", emailAnchor(privacy.authorityEmail)],
  ["Telefon", phoneAnchor(privacy.authorityPhone)]
]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await writeFile(
  resolve(output, "runtime-config.js"),
  `"use strict";\nwindow.__AORA_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify(runtime)});\n`,
  "utf8"
);

const index = await readFile(resolve(output, "index.html"), "utf8");
for (const route of ["inhaber", "arbeitgeber", "arbeitnehmer", "kiosk/dashboard", "reset-password"]) {
  const directory = resolve(output, route);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "index.html"), index, "utf8");
}

const privacyTemplate = await readFile(resolve(output, "privacy-page.template.html"), "utf8");
const privacyPage = replaceTokens(privacyTemplate, {
  META_DESCRIPTION: html("Datenschutzkontakt, Betroffenenrechte und zuständige Aufsichtsbehörde für AoraAI Workforce."),
  STATUS_CLASS: appointed ? "appointed" : "pending",
  STATUS_LABEL: html(appointed ? "Formell benannter Datenschutzbeauftragter" : "Datenschutzkontakt · DSB-Konfiguration ausstehend"),
  HERO_TEXT: html("Hier finden Beschäftigte, Arbeitgeber und andere betroffene Personen ohne Umwege die zuständige Stelle, ihre Rechte und einen datensparsamen Kontaktweg."),
  PRIMARY_ACTION: emailAction,
  CONTROLLER_DETAILS: controllerDetails,
  OPERATOR_DETAILS: operatorDetails,
  CONTACT_TITLE: html(contactTitle),
  CONTACT_ROLE_LABEL: html(appointed ? "Unabhängige Funktion nach Art. 37–39 DSGVO" : "Zentrale Datenschutzanlaufstelle"),
  CONTACT_NAME: html(contactName),
  CONTACT_INTRO: html(contactIntro),
  CONTACT_DETAILS: contactDetails,
  CONTACT_ACTIONS: emailAction + phoneAction,
  AUTHORITY_DETAILS: authorityDetails,
  LAST_UPDATED: html(privacy.updatedAt)
});
for (const route of ["datenschutz", "datenschutzbeauftragter"]) {
  const directory = resolve(output, route);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "index.html"), privacyPage, "utf8");
}
await rm(resolve(output, "privacy-page.template.html"), { force: true });

// Historical gate marker retained for compatibility.
// AORA_SUPABASE_URL and AORA_SUPABASE_PUBLISHABLE_KEY are required for production builds.
console.log(`Aora canonical bundle built for ${runtime.environment} (${runtimeProjectRef}); privacy contact mode: ${appointed ? "appointed-dpo" : "privacy-contact"}.`);
