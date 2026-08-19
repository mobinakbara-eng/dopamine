# Inventory Domain Rules

AORA inventory should be operationally simple for hospitality/retail teams while preserving an auditable stock history.

## Core concepts
Recommended conceptual entities:
- item/SKU
- inventory location
- current stock projection
- stock movement ledger
- supplier
- supplier item/pack mapping
- purchase order and lines
- stock count and count lines
- reorder rule
- audit metadata

Do not treat the mutable `stock` number as the only source of truth. Important changes should be attributable to movements/events.

## Stock movement fields
For each material movement retain enough information to reconstruct and audit it:
- movement id
- workspace
- location
- item
- quantity delta and unit
- reason/type
- actor/source
- timestamp
- correlation/idempotency key where external/retryable
- related order/count/task if applicable

## Ordering workflow
Manager intent should be short:
1. review low-stock/suggested items
2. select/confirm supplier
3. adjust quantities
4. choose available communication channel
5. review generated order
6. send
7. record status and communication evidence

Separate `generate/review` permission from `send` permission. Supplier contact data can include email, WhatsApp/phone, preferred channel, minimum order, cutoff, lead time, delivery days and notes.

## Employee scanning
Employee QR/barcode workflows must be permission-scoped and optimized for repeated scans. A scan should identify an item or task context, not grant extra authorization. Handle unknown code, duplicate scan, wrong location and offline/retry states explicitly.

## Counts
Stock counts should support draft -> submitted -> reconciled lifecycle. Reconciliation creates auditable movements; do not silently overwrite history.
