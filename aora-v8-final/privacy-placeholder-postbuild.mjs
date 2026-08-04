import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const routes=["datenschutz","datenschutzbeauftragter"];
const replacements=new Map([
  ["Ihr Arbeitgeber / Betreiber des Aora-Arbeitsbereichs","(Name des verantwortlichen Arbeitgebers eintragen)"],
  ["Kontaktdaten gemäß Arbeitsvertrag und Unternehmensangaben","(Vollständige Anschrift des Arbeitgebers eintragen)"],
  ["Über den Arbeitgeber bzw. die Personalstelle","(E-Mail-Adresse des verantwortlichen Arbeitgebers eintragen)"],
  ["Rechtlicher Betreiber gemäß Vertrag und Unternehmensangaben","(Rechtlichen Namen des Plattformbetreibers eintragen)"],
  ["Angaben gemäß Vertrag und Unternehmenskommunikation","(Vollständige Anschrift des Plattformbetreibers eintragen)"],
  ["Datenschutzkontakt des Betreibers","(Name oder Firma der Datenschutz-Ansprechstelle eintragen)"],
  ["Wird über die Deployment-Konfiguration veröffentlicht","(Datenschutz-E-Mail-Adresse des Plattformbetreibers eintragen)"],
  ["Kontaktadresse wird vor der Produktivfreigabe hinterlegt","(Datenschutz-E-Mail-Adresse eintragen)"],
]);
const pendingContactDetails=`<ul class="privacy-detail-list">
  <li><b>Person</b><span>(Name der bestellten Person eintragen)</span></li>
  <li><b>Organisation</b><span>(Name des externen Datenschutzbüros eintragen – falls vorhanden)</span></li>
  <li><b>E-Mail</b><span>(E-Mail-Adresse des Datenschutzbeauftragten eintragen)</span></li>
  <li><b>Telefon</b><span>(Telefonnummer eintragen – optional)</span></li>
  <li><b>Postanschrift</b><span>(Postanschrift eintragen – optional)</span></li>
</ul>`;

for(const route of routes){
  const path=resolve(root,"dist",route,"index.html");
  let html=await readFile(path,"utf8");
  for(const [from,to] of replacements)html=html.replaceAll(from,to);
  if(html.includes("DSB-Konfiguration ausstehend")){
    const contactStart=html.indexOf('<article class="privacy-contact-card">');
    const contactEnd=html.indexOf('</article>',contactStart);
    if(contactStart>=0&&contactEnd>contactStart){
      const segment=html.slice(contactStart,contactEnd);
      const replaced=segment.replace(/<ul class="privacy-detail-list">[\s\S]*?<\/ul>/,pendingContactDetails);
      html=html.slice(0,contactStart)+replaced+html.slice(contactEnd);
    }
  }
  await writeFile(path,html,"utf8");
}
console.log("Privacy legal placeholders rendered without inventing controller or DPO identity data.");
