---
name: aora-inventory
description: Design, implement or debug AORA inventory, stock movements, supplier ordering, stock counts, reorder rules and employee QR/barcode scanning. Use for warehouse/inventory workflows and supplier communication features.
---

# AORA Inventory

Read `agent-plugin/references/inventory-domain.md` before material inventory design.

## Principles
- Current stock is a projection; important stock changes need an auditable movement/event.
- Every query and mutation is workspace/location scoped.
- Stock count reconciliation creates movements rather than silently rewriting history.
- Supplier order generation/review is distinct from permission to send.
- Communication channel selection must respect actually configured supplier channels.
- Employee scanning identifies context; it does not expand authorization.

## Required edge cases
- unknown item/code
- duplicate scan/mutation
- wrong location
- concurrent count/order updates
- unit/pack conversion
- minimum order/cutoff/lead time
- supplier unavailable or missing channel
- partial delivery/cancellation
- retry after uncertain network result

For UX changes, pair with competitor research and UX review. For data model changes, pair with Supabase/backend and tenancy/RBAC.
