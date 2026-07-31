# ADR-0001: Pooled main account with a seller wallet ledger

**Status**: Accepted
**Date**: 2026-07-31
**Authors**: @VIncentTetteh

## Context

Until now every buyer payment was split by Paystack at charge time. Each seller
had their own Paystack subaccount with `percentage_charge` set to SnapDuka's fee;
Paystack routed the remainder to that subaccount and settled it to the seller's
bank on its own schedule. **SnapDuka never touched seller money.**

That had a real virtue — no custody, no float, no reconciliation — and it is why
`docs/product/snapduka-product-requirements.md` listed *"Escrow or SnapDuka
manually holding and paying out seller funds"* as an explicit Non-Goal.

It also had limits:

- The fee was fixed on each subaccount at creation, so changing it meant calling
  Paystack for every existing seller.
- SnapDuka had no record of what a seller had actually earned, only what had been
  ordered. There was no balance to show, no statement, and nothing to reconcile.
- A per-seller subaccount is a Paystack-shaped concept. Anything richer — holds,
  clawbacks on refund, netting a debt against future sales — was impossible.

The requested change: collect the full amount into SnapDuka's main Paystack
account, track what each seller is owed in an internal ledger (their "virtual
account"), and pay them out on request.

### What forced the design

**Paystack dedicated virtual accounts are unavailable.** The API answers
*"Dedicated NUBAN is not available for your business"* — NUBAN is Nigerian and
this is a Ghana/GHS integration. A real per-seller bank account number is
therefore not on the table, so "virtual account" means a ledger-backed balance.

**Transfers out do work**: 57 Ghanaian banks plus MTN, Vodafone and AirtelTigo
mobile money.

**Timing.** Zero real seller subaccounts existed (the only row was a fabricated
demo code) and zero payout requests had ever been made. This is the cheapest
moment the change will ever be.

## Decision

Collect into the main account. Credit sellers in a double-entry ledger. Pay out
on request via the Paystack Transfer API.

Specifics worth recording, because each has a cheaper-looking wrong answer:

**Real debit/credit with signed amounts.** A "value flowing in is positive"
convention does not balance — a charge would credit the seller, platform revenue
*and* the clearing account, all positive. Debits are positive, credits negative,
and every transaction sums to zero.

**Pending, available and reserved are separate accounts, not a status column.**
A status column needs UPDATE on entries, which destroys append-only, and turns
every balance read into a filtered sum. As accounts, releasing a hold is an
ordinary balanced transaction — "when did this become withdrawable, and why" is
a row rather than an overwritten field.

**`balance_minor` is materialised but never trusted.** It exists mainly so the
payout path has a row to *lock*; without it, two concurrent withdrawals both read
the same balance and both pass. Honesty comes from immutable entries, a
trigger-maintained balance, and a daily recompute that asserts they agree.

**Zero-sum is enforced by a deferred constraint trigger at COMMIT**, not only
inside the posting function, so no future migration or psql session can leave the
books unbalanced.

**Writes are revoked from `service_role` too.** Only `post_ledger_transaction`
inserts. RLS answers "who are you", not "do these values make sense" — the same
reasoning that revoked seller writes on `seller_subscriptions`.

**The fee is snapshotted per settlement.** Changing
`country_configs.platform_fee_bps` never alters what an old order gives back on
refund.

**Offline orders post nothing.** Cash on delivery and pay on pickup never reach
SnapDuka, so crediting a wallet for them would invent a debt we do not owe.
SnapDuka still earns no fee on those sales — unchanged, but now visible.

**Holds:** credits land as pending and become available once the order is
delivered plus `payout_hold_days` (default 3). The release re-checks the order,
so one refunded, disputed or cancelled during the hold never becomes withdrawable.

**Withdrawals** are seller-initiated, reserved at request time under a row lock,
and auto-approved at or below `payout_auto_approve_max_minor`; larger ones queue
for an operator.

## Consequences

### Positive

- The seller sees a real balance, a real statement, and can withdraw on demand
  rather than waiting on Paystack's settlement cycle.
- The platform fee is applied by SnapDuka at capture, so a change takes effect
  immediately for every seller with no provider calls.
- Refunds, holds and clawbacks become expressible. A refund after withdrawal
  nets off future sales automatically instead of being unrecoverable.
- Every movement of money is an immutable, auditable, balanced pair of entries.

### Negative

- **SnapDuka is now a custodian.** This reverses a documented Non-Goal.
- Float must be managed. Transfers spend the Paystack *balance*, and money owed
  to sellers is money SnapDuka is holding.
- Reconciliation is now a permanent operational duty, not an optional extra.
- More moving parts: three workers, a transfer webhook, and a reconciler that can
  freeze withdrawals.

### Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Regulatory.** Holding customer funds in Ghana is a licensed activity under the BoG Payment Systems and Services Act | Med | High | **Open item.** Confirm with counsel and with Paystack whether a pooled merchant account with seller sub-balances is permitted under the existing agreement. Some processors mandate split payments precisely to avoid this |
| Paystack auto-settlement drains the balance, so transfers fail while the ledger says sellers are owed | High | High | **Precondition:** disable main-account auto-settlement before enabling withdrawals. `payouts_enabled` defaults to false until proven |
| Refund or chargeback after withdrawal | Med | Med | Hold window; negative balance permitted, flagged `in_arrears`, blocks new withdrawals, nets off future sales; operator write-off RPC |
| Double payout | Low | High | `for update` on the wallet, reservation in the same transaction as the request, one open payout per seller, unique idempotency key, Paystack-side dedupe on our reference |
| Crash between the Paystack call and our write | Med | Med | Three-phase claim/call/record plus a sweeper that asks `GET /transfer/verify/:reference`. A network error is never treated as evidence of failure |
| Transfer OTP re-enabled at Paystack | Low | Med | `status: 'otp'` is a hard failure, never auto-solved — payouts halt loudly instead of stranding money |
| Ledger drifts from the real balance | Low | High | Daily reconciliation; drift freezes withdrawals for that market; corrections are reversing transactions only |

## Rollout

`country_configs.settlement_mode` switches per market: `subaccount` keeps the old
split, `ledger` collects into the main account. Cutover is one row update and is
reversible by one more. Subaccount code is removed only after a market has run on
`ledger` with a clean reconciliation and at least one successful real transfer.

## Superseded product decisions

`docs/product/snapduka-product-requirements.md` §4.2 — the escrow/custody
Non-Goal is amended, under the clause that non-goals may be revisited in later
releases where explicitly stated.
