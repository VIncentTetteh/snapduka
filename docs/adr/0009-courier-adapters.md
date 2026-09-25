# ADR-0009: Courier adapter contract and delivery margin

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Decision
- One `CourierAdapter` contract (`packages/core/src/couriers/adapter.ts`):
  quote, book (idempotent on order id), cancel, track, verifyWebhook,
  parseWebhook. `manual` (seller-arranged) is the fallback for every courier;
  `sandbox` is deterministic for tests; partners start `not_configured`.
- Each courier is switchable by `courier_booking:<id>`. Credentials live in
  Vault via `courier_connections.credentials_secret_id`, never plaintext.
- Quotes fan out with a 4 s timeout, cache 15 minutes in `courier_quotes`, add
  `country_configs.delivery_margin_bps`, and always include the seller's own
  delivery fees. The WhatsApp assistant uses the same `quoteDelivery()`.
- Status changes from any courier go through `advanceFulfillment`; for a
  Protect order a courier's "delivered" is evidence only.
- **Not yet**: ledger accounts for courier payables and delivery margin revenue
  (`courier_payable`, `delivery_margin_revenue`) — required before SnapDuka pays
  couriers itself; until then couriers are paid by the seller.
