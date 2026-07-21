# AoraAI Workforce — V8 Final

This is an isolated overlay build of the canonical `aora/` release 8.0.4.

- `../aora` is copied at build time and is never modified.
- Only files under `overlay/` replace or extend the V8 release.
- The frontend uses the isolated workspace `aora-v8-final-demo`.
- The frontend calls only `aora-v8-final-access` and `aora-v8-final-workspace`.
- The production alias `aora-workforce.vercel.app` and the original workspace `aora-demo` are not deployment targets.

Roles:

- Inhaber: creates stores, invites managers, controls manager store access.
- Arbeitgeber / Manager: manages assigned stores and creates employee accounts by email.
- Mitarbeiter: sees personal work data and receives an email account invitation.
- Kiosk: retains the V8 check-in experience.

Build:

```bash
npm run build
```

Deploy this directory as a separate Vercel project with root directory `aora-v8-final`.
