# Aora 8.1.0 Pilot — Versioned Work Rule Engine QA

Date: 2026-07-28
Environment: isolated staging

## Architecture

- `work_rule_sets` stores effective-dated, organization-scoped rule-set versions.
- `work_rules` stores typed thresholds, severity and exception parameters.
- `work_rule_evaluations` records every backend evaluation with rule-set version, actor, input, violations and optional exception reason.
- `aora_evaluate_shift_rules` calculates timestamps in the rule-set timezone and returns a structured result.
- `aora-v8-pilot-workspace-rules` sits in front of the hardened workspace and enforces rules again for every `ADD_SHIFT`; frontend preflight is not trusted.
- Manager evaluations are limited to assigned locations.
- Successful shifts receive `ruleSetId`, `ruleSetVersion` and `ruleEvaluationId`.

## Pilot baseline

Active types:

- inactive employee: block, no exception
- overlap: block, no exception
- maximum daily work: 600 minutes, block
- break after more than 6 hours: 30 minutes, block
- break after more than 9 hours: 45 minutes, block
- rest between shifts: 660 minutes, block with documented exception support
- overnight: hint
- DST transition: confirmation with documented reason

Prepared but not fully activated in the pilot:

- rolling weekly-average enforcement
- minor-employee rules requiring verified birth date and separate youth-law logic

## Executed database test vectors

| Scenario | Result | Key evidence |
|---|---|---|
| Normal 08:00–16:00, 30 min break | valid | no violations |
| Overlap with existing 10:00–12:00 | blocked | `SHIFT_OVERLAP` |
| Inactive employee | blocked | `INACTIVE_EMPLOYEE` |
| 6h01 with no break | blocked | `MIN_BREAK_AFTER_6H` |
| 9h01 with 30 min break | blocked | `MIN_BREAK_AFTER_9H` |
| 8-hour rest, no reason | blocked / confirmation required | `MIN_REST_BETWEEN_SHIFTS` |
| 8-hour rest, documented reason | valid override | reason and rule version recorded |
| 22:00–06:00 | valid with hint | `OVERNIGHT_SHIFT`, 480 real minutes |
| DST spring 2026-03-29 01:30–04:30 | confirmation required | 120 real vs 180 wall minutes, delta −60 |
| DST fall 2026-10-25 01:30–04:30 | confirmation required | 240 real vs 180 wall minutes, delta +60 |

All evaluations referenced rule-set version 1.

## HTTP enforcement

- clean shift preflight returned HTTP 200
- overlapping `ADD_SHIFT` was rejected by the server wrapper with HTTP 422
- confirmation-capable violations are mapped to HTTP 428
- invalid or unauthorized location data cannot be bypassed by changing frontend fields

## UX

- New German shift modal performs backend preflight.
- Violations display required/actual minutes and severity.
- Non-overridable rules only offer “Schicht ändern”.
- Allowed exceptions require at least five characters and explain that the reason is stored in the audit record.
- Owner/Manager settings include “Arbeitszeitregeln” and load the active backend version and rule list.

This is a configurable pilot baseline and not a claim of universal legal or tariff compliance. Sector, tariff, averaging and youth rules require organization-specific configuration and review.