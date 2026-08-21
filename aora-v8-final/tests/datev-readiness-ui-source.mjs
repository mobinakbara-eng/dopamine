import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui=fs.readFileSync(new URL('../app/modules/datev-integration.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const readiness=fs.readFileSync(new URL('../docs/DATEV_PARTNER_READINESS.md',import.meta.url),'utf8');
const onboarding=fs.readFileSync(new URL('../docs/DATEV_CUSTOMER_ONBOARDING.md',import.meta.url),'utf8');
const acceptance=fs.readFileSync(new URL('../docs/DATEV_TECHNICAL_ACCEPTANCE_TEST_PLAN.md',import.meta.url),'utf8');

// The readiness UI is staging/preview-only until production DATEV approval exists.
assert.match(ui,/CFG\.environment!=="production"/);
assert.match(ui,/typeof isOwner==="function"&&isOwner\(\)/);

// DATEV calls are authenticated with the existing AORA session and never receive secrets from form input.
assert.match(ui,/"Authorization":`Bearer \$\{token\}`/);
assert.doesNotMatch(ui,/clientSecret|client_secret|refreshToken|refresh_token\s*[:=]/i);
assert.doesNotMatch(ui,/localStorage\.setItem|sessionStorage\.setItem/);

// Connection state and required DATEV user controls are explicit.
assert.match(ui,/Mit DATEV verbinden/);
assert.match(ui,/Verbindung prüfen/);
assert.match(ui,/Verbindung trennen/);
assert.match(ui,/Verbundene Anwendungen/);
assert.match(ui,/datevClientId/);
assert.match(ui,/issuerName/);
assert.match(ui,/refreshTokenExpiresAt/);
assert.match(ui,/lastAccessCheckAt/);

// The UI must not claim partnership or technical approval.
assert.match(ui,/Partnerstatus oder technische Freigabe werden hier nicht behauptet/);
assert.doesNotMatch(ui,/DATEV Partner[^s]/);

// hr:exchange remains the primary partner-readiness route and writes stay transparently gated.
assert.match(ui,/const DATEV_SERVICE="hr_exchange"/);
assert.match(ui,/writeTransportReady/);
assert.match(ui,/OpenAPI-Vertrag/);

// Defensive redirect handling must only allow HTTPS DATEV hosts.
assert.match(ui,/target\.protocol!=="https:"/);
assert.match(ui,/target\.hostname\.endsWith\("\.datev\.de"\)/);

// Assets are included after the base admin module so settingsPage can be extended safely.
assert.match(index,/datev-integration\.css/);
assert.match(index,/modules\/admin\.js[\s\S]*modules\/datev-integration\.js/);

// Readiness documentation must preserve the actual incomplete state.
for(const doc of [readiness,onboarding,acceptance]){
  assert.match(doc,/does not|do not|not claim|nicht|No DATEV|Noch kein|Until DATEV/i);
}
assert.match(readiness,/25 customers/);
assert.match(readiness,/three reference customers/i);
assert.match(readiness,/DATEV LODAS and DATEV Lohn und Gehalt/);
assert.match(acceptance,/sample data|test data/i);
assert.match(acceptance,/counter-booking|Gegenbuchung/i);

console.log('DATEV readiness UI/documentation source contracts passed.');
