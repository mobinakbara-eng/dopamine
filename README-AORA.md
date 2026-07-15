# Aora Workforce

Aora is a web-based workforce operating system with three isolated surfaces:

- `/admin` — employer dashboard, schedules, time, leave, communication and kiosk control
- `/employee` — mobile employee area
- `/kiosk` — touch-friendly three-column time clock

## Stack

- Static HTML/CSS/JavaScript
- Supabase PostgreSQL + Edge Functions
- Vercel hosting
- Sessions are stored in `sessionStorage`, not persistent local storage

## Brand

- Black / White / `#EDEDED` / `#B8B8B8`
- Sora headings
- Manrope UI text
- No gradients

## Backend

The frontend is connected to the `aora-workforce-staging` Supabase project and uses the public publishable key only. Never commit the Supabase service-role key.

The shared Workspace endpoint provides revision-safe writes for Admin, Employee and Kiosk roles.
