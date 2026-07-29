# Aora environment contract

| Environment | Vercel target | Supabase project | Data policy |
| --- | --- | --- | --- |
| development | local | staging by default | test workspaces only |
| preview | Vercel Preview | staging | isolated CI tenant |
| staging | stable staging alias | staging | pilot and QA data |
| production | Vercel Production | production only | customer data |

Production builds fail closed when database configuration is missing or when the
staging project ref `xqgkawskftzurbujrpex` is configured.

The application is built from `aora-v8-final/app`. The historical `aora` and
`overlay` source trees no longer participate in the build.

Public invitation and kiosk links must use `AORA_CANONICAL_ORIGIN`. Immutable
Vercel preview URLs are test artifacts and must never be sent to customers.

No new paid runtime dependency is introduced by this contract.
