import fs from 'node:fs';
import assert from 'node:assert/strict';

const edge = fs.readFileSync(new URL('../supabase/functions/aora-v8-datev-integration/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260821152000_aora_datev_integration_foundation.sql', import.meta.url), 'utf8');
const hardening = fs.readFileSync(new URL('../supabase/migrations/20260821152500_aora_datev_oauth_secret_hardening.sql', import.meta.url), 'utf8');

// OAuth/OIDC must remain standards-based and server-owned.
assert.match(edge, /oauth4webapi@3\.8\.7/);
assert.match(edge, /generateRandomState\(\)/);
assert.match(edge, /generateRandomNonce\(\)/);
assert.match(edge, /generateRandomCodeVerifier\(\)/);
assert.match(edge, /calculatePKCECodeChallenge/);
assert.match(edge, /ClientSecretBasic/);
assert.match(edge, /validateAuthResponse\(as,client,url,state\)/);
assert.match(edge, /expectedNonce:nonce/);
assert.doesNotMatch(edge, /localStorage|sessionStorage|IndexedDB/);

// Only exact DATEV payroll scopes are requested, with long-term scope added explicitly.
assert.match(edge, /datev:hr:payrolldataupload/);
assert.match(edge, /datev:hr:payrolldataexchange/);
assert.match(edge, /offline_access/);
assert.match(edge, /datev:iam:client:/);

// Browser clients may not read provider secrets; database policy is fail-closed.
assert.match(migration, /datev_connection_secrets/);
assert.match(migration, /edge_only_deny_direct/);
assert.match(migration, /refresh_token_ciphertext/);
assert.doesNotMatch(migration, /access_token\s+text/i);
assert.match(hardening, /aora_rotate_datev_refresh_token_atomic/);
assert.match(hardening, /datev_refresh_token_generation_conflict/);

// Connection is only considered valid after explicit DATEV client access verification.
assert.match(edge, /verifyClientAccess\(connection,result\.access_token/);
assert.match(edge, /status:"connected"/);

// DATEV technical logs capture metadata, never payloads or authorization values.
assert.match(edge, /datev_http_logs/);
assert.match(edge, /query_keys/);
assert.doesNotMatch(edge, /datev_http_logs[\s\S]{0,800}(authorization|refresh_token|access_token|client_secret)\s*:/i);
assert.match(migration, /interval '30 days'/);

// hr:exchange polling must respect DATEV's one-minute cadence and finite review window.
assert.match(edge, /POLL_MIN_MS=60_000/);
assert.match(edge, /POLL_MAX_MS=15\*60_000/);
assert.match(edge, /datev_poll_too_soon/);
assert.match(edge, /datev_poll_window_exceeded/);

// Provider writes remain explicitly gated until the subscribed OpenAPI DTOs are pinned/tested.
assert.match(edge, /DATEV_HR_FILES_UPLOAD_ENABLED/);
assert.match(edge, /DATEV_HR_EXCHANGE_WRITES_ENABLED/);
assert.match(edge, /OpenAPI/);

// The manual first step is a real LODAS ASCII artifact with CRLF and explicit booking keys.
assert.match(edge, /Ziel=LODAS/);
assert.match(edge, /u_lod_bwd_buchung_standard/);
assert.match(edge, /\\r\\n/);
assert.match(edge, /unit==="amount"\?"02":unit==="hours"\?"01"/);
assert.match(edge, /not_test_imported/);
assert.match(edge, /3\*1024\*1024/);

console.log('DATEV payroll integration source contracts passed.');
