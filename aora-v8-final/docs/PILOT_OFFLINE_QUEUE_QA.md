# Aora 8.1.0 Pilot — Encrypted Offline Queue

Date: 2026-07-28
Environment: isolated preview

## Implemented

- IndexedDB database `aora-pilot-offline` with stores for queued punches, non-extractable device keys and encrypted Kiosk sessions.
- AES-GCM 256 encryption with a random 96-bit IV and authenticated additional data bound to organization, device, purpose and event ID.
- The CryptoKey is generated non-extractable and stored as a structured-cloned CryptoKey in IndexedDB; it is never written to Local Storage.
- Queue records contain ciphertext and delivery metadata only. Employee ID and transition remain inside the encrypted payload.
- Punch is queued before network delivery and keeps the same server idempotency UUID.
- Online fallback sync plus Service Worker Background Sync.
- Pending, syncing and offline German status banners.
- Kiosk session material is encrypted before being made available to the Service Worker and is removed on logout.
- Definitive server responses remove the queue record; retryable failures retain it.

## Automated evidence

The Vercel build executes `tests/offline-crypto.mjs` and verifies:

- key is non-extractable
- raw key export is rejected
- AES-GCM authenticated round trip succeeds
- wrong additional data cannot decrypt
- stored-record serialization does not contain the employee ID
- stored-record serialization does not contain the punch transition
- no plaintext payload property exists

Latest preview build is READY. The built Service Worker is available with HTTP 200 and points to `aora-v8-pilot-kiosk`. No Vercel runtime warning/error/fatal log was observed for the deployment.

## Browser E2E still required

The following acceptance tests are intentionally left for P0-6 Playwright because they require an executing browser rather than static/source inspection:

- punch while browser context is offline
- queue survives page/PWA reload
- reconnect triggers automatic synchronization
- retry creates no duplicate receipt/time entry
- IndexedDB DevTools-style inspection confirms no plaintext employee/transition payload
- conflict remains visible for Manager review

P0-3 implementation is complete, but its final acceptance status remains pending until these browser tests pass.