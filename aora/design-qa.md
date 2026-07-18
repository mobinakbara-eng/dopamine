# AoraAI Workforce Design QA

Release `8.0.4-production` passed browser verification on 2026-07-18.

Production deployment `dpl_4nAStarcJ4UZktdmXfm7GCuYdoxJ` is `READY` at `https://aora-workforce.vercel.app`.

- References: `2.jpg`, `22.jpg`, and the supplied AoraAI Brand Book.
- Evidence: `qa/kiosk-final-1280x960.png` at `1280x960`; responsive verification at `1024x768`.
- Kiosk count badges measure `32x32`; no horizontal overflow or clipped persistent controls.
- Kiosk selection, Pause, Pause beenden, Help, and synchronized status updates passed.
- Arbeitnehmer and Arbeitgeber routes and staging logins passed.
- Browser console contained no warnings or errors on all three routes.
- All JavaScript modules pass `node --check`.

Final result: `passed`
