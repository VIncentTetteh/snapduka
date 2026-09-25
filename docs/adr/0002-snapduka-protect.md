# ADR-0002: SnapDuka Protect — hold until delivery is confirmed

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

The commonest failure of social commerce in Ghana is trust: buyers who have been
told "pay first" and then blocked insist on pay-on-delivery, which pushes the
risk onto sellers and caps what either side will do online. ADR-0001 already put
online payments into SnapDuka's pooled account with a per-seller ledger, and
started each order's settlement hold when the order became *fulfilled*.

"Fulfilled" was the seller's own claim. Five surfaces could set it (dashboard,
bulk action, mobile, the public fulfilment API, the courier webhook), and the
public API did so with no state machine at all. Under Protect, that claim would
be a claim on the buyer's money.

## Decision

1. **Protect is a layer over existing records**, not a new order model:
   `orders.protection_mode`, a buyer-paid `protect_fee_minor` inside
   `total_minor`, one `order_protections` row per protected order, and the
   existing `order_settlements` + ledger for money.
2. **Only evidence releases money.** A database trigger (`guard_protected_order`)
   refuses `fulfilled`/`completed` on a held protected order unless the change
   comes from the Protect functions in the same transaction. Evidence is: the
   buyer's six-digit code entered by the rider, the buyer confirming themselves,
   a timeout (168 h, shortened to 72 h by a courier's own delivery report), or
   an operator decision. `stamp_order_fulfilled_at` no longer starts a protected
   order's hold.
3. **State machine** (`protect_state`): `held → in_transit → releasable →
   released`, with `disputed`, `refunded`, `cancelled` branches. After
   confirmation a 24 h inspection window runs, then the ordinary hold.
4. **Delivery code**: generated from `gen_random_bytes`, stored as bcrypt,
   delivered to the buyer's phone via a `protect.code_issued` outbox event whose
   plaintext is redacted after sending. The tracking page can rotate it and show
   the new code to the tracking-token holder only. Five wrong codes lock for 30
   minutes; the rider page is also rate-limited per token and IP.
5. **Disputes**: a buyer case about delivery or the item freezes the settlement
   at once (trigger on `support_cases`), whichever route opened it. Operators
   resolve with an explicit outcome — release or refund — never the generic case
   status, because the money needs to know who won.
6. **Card chargebacks** are handled in the same ledger: freeze, reserve the
   seller's share in a seller-owned `seller_dispute_reserve` if already
   released, settle on resolution, pro-rata to the settlement's own split.
7. **Rollout**: per-market `protect_enabled`, the `protect` feature flag per
   seller, ledger settlement required (per-seller override for pilots), a
   per-order cap and a cap on total money held.

## Consequences

### Positive
- Buyers can pay online without trusting a stranger; sellers get paid-up-front
  sales instead of COD risk.
- The release gate is enforced in the database, so a future completion path
  cannot bypass it by forgetting.
- Every Protect path is covered by one pgTAP lifecycle test that also asserts the
  ledger invariants still hold.

### Negative
- Sellers wait longer for protected money (delivery + inspection + hold).
- A protected order cannot be completed from the dashboard; sellers must learn
  that the buyer's confirmation completes it.
- The Protect fee is not refunded to the platform side on a chargeback; SnapDuka
  absorbs it.

### Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Holding buyer funds without the right licence (Act 987) | Med | High | Ships dark; GA gated on a legal opinion; float cap until then |
| Seller's own rider "confirms" without delivering | Med | Med | Code goes only to the buyer; buyer confirmation preferred; inspection window; courier report is evidence only |
| Code brute force | Low | High | 6 digits, 5-attempt lockout, rate limits per token and IP |
| Buyer never confirms | High | Low | Timeout auto-confirms; courier evidence shortens it |
| Paystack dispute payload differs from assumptions | Med | Med | Conservative mapping (anything but `declined` is lost); verify with a sandbox dispute before enabling |
