# AoraAI Workforce — Original Identity Production

This branch restores the original AoraAI product identity shown in the approved Employee, Employer and Kiosk captures.

## Routes

- `/employee` — mobile-first employee workspace
- `/admin` — employer operations dashboard
- `/kiosk` — three-zone workforce check-in

## Visual source of truth

- Black `#000000`
- White `#FFFFFF`
- Cool gray `#EDEDED`
- Soft gray `#B8B8B8`
- Original AoraAI symbol and wordmark proportions
- Sora display typography and Manrope interface typography

## Runtime

The frontend connects to the existing Aora Supabase staging workspace through the rate-limited `aora-access` endpoint and the revision-safe `workspace` endpoint. Sessions use `sessionStorage` and are isolated per browser tab.

## Production files

- `index.html`
- `styles.css`
- `modules/core.js`
- `modules/access.js`
- `modules/employee.js`
- `modules/admin.js`
- `modules/kiosk-helpers.js`
- `modules/kiosk-view.js`
- `modules/modals.js`
- `modules/handlers.js`
- `modules/boot.js`
