# ADR-0010: Seller KYC and trust score

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Decision
- A KYC provider interface with `sandbox` and `not_configured` implementations;
  vendor open (Smile ID, Youverify, Dojah, Prembly — compare Ghana Card
  coverage, price per check, data residency). `kyc_checks` stores masked ids and
  vendor references only; the database refuses raw ID numbers and images
  (Data Protection Act 2012, Act 843).
- A pass sets `seller_verifications` to verified; operator rejection or
  suspension is never overridden; a verified seller is never demoted by a later
  failed check.
- A nightly, keyset-batched trust score (weights version `v1`) with tiers
  new/bronze/silver/gold/watch. `watch` is never shown to buyers. Instant
  withdrawals require bronze or above.
- Risk signals are recorded at checkout, payout and verification; observe-only
  until specific rules are promoted to blocking.
- Next inputs once data accrues: Protect delivery-code confirmation rate,
  chargebacks (`payment_disputes`), WhatsApp response time.
