# ADR-0015: Creator commissions paid through the ledger

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

The creator programme (migrations 202607290047/0048) was record-only: SnapDuka
computed what a seller owed a creator, the seller paid off-platform, and pressed
"mark as paid". That was right when SnapDuka never held the money — its header
calls holding third-party funds a non-goal.

ADR-0001 changed that for online orders. For an order captured on ledger
settlement (an `order_settlements` row exists) the whole payment sits in
SnapDuka's pooled account and the seller's share is credited in the ledger. The
creator's cut is therefore money SnapDuka is already holding — and the
record-only flow hands all of it to the seller and trusts them to pass the
creator's share on. The failure mode is the one the creator payment
confirmation (202607300049) exists to surface: the creator is not paid.

## Decision

For online orders SnapDuka captured, the creator is paid by SnapDuka, out of the
seller's settlement, into a creator-owned wallet in the same double-entry
ledger. Everything else (cash on delivery, pay on pickup, sellers on the legacy
subaccount split, sellers outside the rollout) keeps the record-only flow.

1. **Creator-owned accounts.** `ledger_accounts.owner_creator_id` (single-column
   FK) and three liabilities mirroring the seller trio: `creator_pending`,
   `creator_available`, `creator_payout_reserved`. A separate owner check
   (`ledger_accounts_creator_owner_check`) rather than editing the seller one,
   because other migrations rebuild that one by parsing its kind list.
   `post_ledger_transaction` keeps its exact signature; a line may carry
   `creator_id`, and the transaction's `creator_id` is derived from its lines.
2. **The path is decided once.** At accrual, a commission is `settlement =
   'ledger'` when the order is paystack, the seller is on ledger settlement and
   the seller is in the `creator_ledger_payouts` rollout; otherwise `manual`. A
   trigger forbids changing it once ledger money has moved.
3. **Accrual** (`creator_accrual`): seller_pending → creator_pending, when both
   the commission and the settlement exist (the accrual trigger fires before
   capture inside `apply_paystack_success`, so both call the same idempotent
   function). A commission that cannot fit in the seller's pending share falls
   back to manual before any money moves (unreachable with today's fee and rate
   caps; defensive).
4. **Release rule** (`creator_release`): withdrawable when BOTH the order's
   settlement has released AND the commission's own hold (`payable_at`) has
   elapsed. Applied by the order-settlement release (same pass) and the nightly
   creator release. On release the commission is `paid` with no
   `payment_id` — paid by SnapDuka, not recorded by the seller.
5. **Reversal** (`creator_reversal`): the commission is reduced by exactly what
   the record-only engine always computed; the difference comes from
   creator_pending, then creator_available (which may go negative: `in_arrears`,
   netted off future commissions, exactly like a seller), and goes back to
   wherever the seller's share currently sits. After a full card chargeback lost
   while held it goes to platform_revenue instead, because the dispute capped the
   seller's share at their (already reduced) pending and SnapDuka absorbed the
   creator's cut.
6. **Withdrawals** reuse the seller payout machinery: `payout_destinations` and
   `payout_requests` are generalised with a nullable `creator_id` and an
   exactly-one-owner check, so one worker, one claim/transfer/webhook path, one
   stale-claim sweeper and one operator queue serve both. Standard daily batch
   only. Creator destinations resolve the account holder's name with Paystack
   before saving (creators have no registered entity to name the recipient
   after), and are rate-limited because every lookup reveals a name.

## Consequences

### Positive
- A creator promoting an online-paying shop is paid without depending on the
  seller's honesty or memory; the "shop says it paid you" dispute disappears for
  those orders.
- Every creator money movement is an immutable, balanced, auditable pair of
  entries, checked nightly (`creator_pending_mismatch` joins the invariants) and
  counted as a liability in reconciliation.
- Declining a withdrawal (operator reject) now returns the reservation — for
  sellers too, which previously stranded it in `*_payout_reserved`.

### Negative
- SnapDuka now holds and disburses creator money: the custody position of
  ADR-0001 extends to a second class of payee who has not been KYC'd as a seller.
- Two settlement paths coexist per creator; screens must show both.
- A creator's balance in a currency other than their own country's is held but
  cannot yet be withdrawn (destinations are per the creator's country).

### Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Paying unverified third parties from the pooled account (Act 987 / AML) | Med | High | Ships dark (`creator_ledger_payouts`, per seller); legal opinion before widening; payouts respect the market kill switch and auto-approve ceiling |
| Account-takeover drains a creator wallet | Med | Med | 24 h cool-off after any destination change; one open withdrawal; daily cap |
| Name-lookup abuse via destination setup | Med | Low | 5 lookups per creator per hour; account number never stored or echoed |
| Creator share and settlement drift apart | Low | High | Posting and row updates in one function per step; `creator_pending_mismatch` invariant freezes payouts on drift |
| Refund after the creator withdrew | Med | Low | creator_available goes negative and nets off future commissions, like a seller |
