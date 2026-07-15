# AoraAI Workforce Production 8.0.3

This directory is the canonical deployable frontend for AoraAI Workforce.

## Routes

- `https://aora-workforce.vercel.app/arbeitnehmer/` - employee app
- `https://aora-workforce.vercel.app/arbeitgeber/` - employer dashboard
- `https://aora-workforce.vercel.app/kiosk/dashboard/` - kiosk mode

## Backend

The frontend uses the Supabase project `aora-workforce-staging` through the
`aora-access-pages` and `workspace` Edge Functions. Status changes, schedules,
leave requests, news, audit records, and employee profile updates are stored in
the shared workspace and refreshed across devices every five seconds and on
window focus.

## Deployment

Deploy this directory as a static Vercel project. No frontend secrets are
required. Authentication is handled by short-lived staging sessions issued by
the access Edge Function. Never commit staging PINs or session tokens.
