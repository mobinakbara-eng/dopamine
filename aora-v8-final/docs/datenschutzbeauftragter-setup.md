# Datenschutzbeauftragter und Datenschutzkontakt in AoraAI Workforce

## Warum die Umsetzung zweistufig ist

Eine Website kann eine Kontaktstelle sichtbar machen, sie kann aber keine natürliche Person oder Dienstleistungsfirma rechtswirksam zum Datenschutzbeauftragten bestellen. Die formelle Benennung muss organisatorisch erfolgen und die Anforderungen aus Art. 37–39 DSGVO sowie gegebenenfalls § 38 BDSG erfüllen.

Aora unterscheidet deshalb bewusst zwischen:

1. **Datenschutzkontakt** – eine zentrale Kontaktstelle, ohne die gesetzliche Funktionsbezeichnung zu beanspruchen.
2. **Formell benannter Datenschutzbeauftragter** – wird erst angezeigt, wenn die Bestellung dokumentiert und die Deployment-Konfiguration vollständig gesetzt ist.

## Vor der Aktivierung als „Datenschutzbeauftragter“

- Prüfen und dokumentieren, ob eine Benennung nach Art. 37 DSGVO oder § 38 BDSG verpflichtend ist.
- Internen oder externen DSB auswählen und Fachkunde nachweisen.
- Interessenkonflikte ausschließen; insbesondere keine Person einsetzen, die Zwecke und Mittel der Verarbeitung selbst bestimmt.
- Direkten Zugang zur höchsten Managementebene sicherstellen.
- Zeit, Budget, Zugriff und Fortbildung bereitstellen.
- Verschwiegenheit und unabhängige Aufgabenwahrnehmung schriftlich regeln.
- Kontaktdaten veröffentlichen und der zuständigen Aufsichtsbehörde mitteilen.
- Standardprozess für Betroffenenanfragen, Datenschutzvorfälle und DSFA-Beteiligung festlegen.

## Deployment-Konfiguration

Die Seite `/datenschutz/` und der Alias `/datenschutzbeauftragter/` werden beim Build als eigenständige, scriptfreie HTML-Seiten erzeugt.

### Verantwortlicher und Betreiber

```text
AORA_PRIVACY_CONTROLLER_NAME
AORA_PRIVACY_CONTROLLER_ADDRESS
AORA_PRIVACY_CONTROLLER_EMAIL
AORA_PRIVACY_OPERATOR_LEGAL_NAME
AORA_PRIVACY_OPERATOR_ADDRESS
AORA_PRIVACY_CONTACT_NAME
AORA_PRIVACY_EMAIL
AORA_PRIVACY_UPDATED_AT
```

Bei Beschäftigtendaten ist grundsätzlich der jeweilige Arbeitgeber Verantwortlicher. Der Plattformbetreiber ist für eigene technische Betriebs-, Sicherheits- und Kontaktdaten verantwortlich. Diese Rollen dürfen auf der Seite nicht vermischt werden.

### Formell benannter Datenschutzbeauftragter

```text
AORA_DPO_APPOINTED=true
AORA_DPO_NAME
AORA_DPO_COMPANY
AORA_DPO_EMAIL
AORA_DPO_PHONE
AORA_DPO_ADDRESS
```

Wenn `AORA_DPO_APPOINTED=true` gesetzt wird, verlangt der Build mindestens einen öffentlichen Kontaktkanal aus E-Mail, Telefon oder Postanschrift. Ohne diese Konfiguration bleibt die sichtbare Rolle „Datenschutzkontakt“.

### Zuständige Aufsichtsbehörde

Die Defaultwerte beziehen sich auf Berlin und können ersetzt werden:

```text
AORA_PRIVACY_AUTHORITY_NAME
AORA_PRIVACY_AUTHORITY_ADDRESS
AORA_PRIVACY_AUTHORITY_EMAIL
AORA_PRIVACY_AUTHORITY_PHONE
```

## Technische Eigenschaften

- eigenständige Seite ohne Supabase-Skripte
- keine Google Fonts oder sonstige externen Ressourcen
- keine Cookies, Analytics oder Tracking-Pixel
- kein serverseitiges Kontaktformular und keine neue Datenspeicherung
- E-Mail wird nur über ein `mailto:`-Link im lokalen Mailprogramm vorbereitet
- Links aus Login, Arbeitgeber-/Inhaber-Navigation, Mitarbeiterbereich „Mehr“ und Kiosk
- responsive Darstellung, Tastaturfokus, Skip-Link und Reduced-Motion-Unterstützung
- Browser- und Source-Tests verhindern unersetzte Platzhalter, erfundene Aora-DPO-Adressen und versteckte externe Requests

## Wichtige Grenze

Die Bestellung eines Datenschutzbeauftragten löst keine anderen Datenschutzprobleme automatisch. Insbesondere muss die Speicherung einer wiederverwendbaren Mitarbeiterunterschrift weiterhin freiwillig sein oder durch eine nicht wiederverwendbare Alternative ersetzt werden. Der DSB berät und überwacht; er ersetzt weder eine Rechtsgrundlage noch eine freiwillige Einwilligung.

## Referenzquellen

- Art. 37–39 DSGVO: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- § 38 BDSG: https://www.gesetze-im-internet.de/bdsg_2018/__38.html
- EDPB SME Guide – Datenschutzbeauftragter: https://www.edpb.europa.eu/sme/be-compliant/data-protection-officer_de
- BfDI – Rolle und Meldeprozess nach Art. 37 DSGVO: https://www.bfdi.bund.de/SharedDocs/Downloads/DE/Themen/Rolle-DSB-Meldeweg.html
- Berliner Beauftragte für Datenschutz und Informationsfreiheit: https://www.datenschutz-berlin.de/
