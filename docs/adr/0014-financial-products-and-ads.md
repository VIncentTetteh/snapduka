# ADR-0014: Stock financing, BNPL and promoted listings

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

Phase 4 of the roadmap moves revenue towards financial services and a
marketplace: revenue-based stock financing, buy-now-pay-later at checkout, and
paid placement on Discover. All three touch seller money, so they have to fit
the ledger from ADR-0001 without bending it, and none of the partners exist yet.

Two constraints shaped everything:

- **SnapDuka does not lend.** Lending from its own balance sheet would need a
  licence it does not have and capital it should not risk. A licensed lending
  partner underwrites and funds every advance; SnapDuka originates (it has the
  data), disburses into the wallet and collects by sweep.
- **The ledger has one writer** (`post_ledger_transaction`) and a set of
  functions several squads redefine. New products must add to it, not fork it.

## Decision

### 1. Revenue-based stock financing (flag `stock_financing`)

**Eligibility is SQL over data SnapDuka already holds**
(`financing_eligibility`, `202609250221`): last-90-day GMV on ledger-captured
orders (`order_settlements`, excluding the buyer's Protect fee), refund rate
(`clawed_back_minor` / GMV), chargeback rate (`payment_disputes` per captured
order), trust tier (`seller_trust_scores`), verification, account age, ledger
settlement mode, and no live or defaulted advance. Every failing reason is
returned so the seller sees the whole list.

**Every parameter is per market in `financing_policies`**, not code: thresholds,
eligible tiers, offer = min(cap, `offer_gmv_bps` of 90-day GMV), fixed
`fee_bps`, `sweep_bps`, SnapDuka's contractual fee share, offer validity, terms
version and which partner adapter funds the market. Seeded disabled with
placeholder numbers; the partner's credit policy sets the real ones.

**Offer → accept → disburse.** `financing_offers` holds the priced offer and an
eligibility snapshot. Acceptance (`accept_financing_offer`) must repeat the
total and terms version the seller was shown, re-checks eligibility, and creates
a `financing_advances` row in `accepted`. No money moves until the partner
confirms funding (`record_financing_disbursement`). Advance states:
`accepted → disbursed → repaying → repaid`, or `cancelled` (partner declined
before any money moved), `defaulted` / `written_off` (partner's call; sweeping
stops). There is no `offered` state on an advance: an offer lives in
`financing_offers` until accepted.

**Ledger** (new kinds in `202609250220`):

| Movement | Debit | Credit |
|---|---|---|
| Disbursement | `partner_clearing` P | `seller_available` P |
| Partner's cash lands | `bank_settlement` P | `partner_clearing` P |
| Sweep | `seller_available` s | `financing_payable` s (seller-owned) |
| Remittance | `financing_payable` r | `partner_clearing` r−k, `financing_fee_revenue` k |
| Transfer to partner | `partner_clearing` t | `bank_settlement` t |

`partner_clearing` is credit-normal: a positive balance is what SnapDuka owes
the partner, negative what the partner owes SnapDuka; zero means settled.
Partner cash moves through `bank_settlement` (as courier settlements do), never
`processor_clearing`, so the daily Paystack reconciliation is unaffected.
Repayments go to the partner first; SnapDuka's contractual share (`k`, default
0) comes out of the last money swept. `record_partner_settlement` bounds each
direction cumulatively (received ≤ disbursed principal; paid ≤ remitted), not
by the netted clearing balance, so a transfer is never refused merely because
funding has not been recorded yet.

**The sweep is a separate worker, not a line in
`release_due_order_settlements`.** That function is the only path by which any
seller's money becomes withdrawable; putting a second product inside its loop
means a financing bug or lock wait stops every seller's releases, and the two
would have to be redefined together forever. `sweep_financing_repayments` reads
the `hold_release` transactions the release already writes, sweeps
`floor(release × sweep_bps / 10000)` capped at what is owed and at the seller's
available balance, once per release (`financing_sweeps` unique per release).
The cost is a gap of up to one tick (pg_cron every 5 minutes) in which released
money is withdrawable before it is swept. Accepted: under revenue-based
financing the partner carries repayment risk; the gap is recorded per sweep as
`shortfall_minor` (not carried forward — the seller's terms say a share of each
release, and a catch-up could take a whole small release). The seller-available
balance is never pushed negative by a sweep.

**Partner seam**: `src/lib/financing/partner.ts` (`FinancingPartner`:
`requestDisbursement`, `sendRepayment`, signed webhooks) with `sandbox` and
`not_configured`. With no partner, the Capital page shows eligibility but no
offer is minted — an offer nobody can fund is a promise nobody can keep.

### 2. BNPL at checkout (flag `bnpl`)

A BNPL partner pays SnapDuka the full order total and owns the buyer's
instalment debt, so to SnapDuka it is a payment provider. `src/lib/bnpl/`
implements `PaymentProvider` (sandbox + not_configured) and is registered in the
provider registry as `bnpl` with `method: "bnpl"`. The router only routes a
method the buyer chose: BNPL is never a fallback for a failed card payment, or
the reverse (`/api/payments/bnpl/initialize` has no fallback). An approval
webhook is captured through `apply_paystack_success` with a normalised payload —
the one function that marks an order paid, consumes stock, books the settlement
and opens Protect — so there is no second capture path. The attempt is bound to
the partner (`route_reason = bnpl:<partner>`) and only that partner's signed
webhook can capture it. Ledger sellers only. The partner's merchant discount is
booked as `processor_fees` (borne by SnapDuka, like the Paystack fee).

### 3. Promoted listings (flag `promoted_listings`)

**Gated at roughly 10k weekly active sellers** (roadmap Tier 4): below that the
directory is small enough that paid placement crowds out organic results rather
than adding reach. Ships dark.

**Prepaid only.** `ads_top_up` moves `seller_available → ads_prepaid`
(seller-owned) and refuses to take available below zero; each billed click moves
`ads_prepaid → ads_revenue`; unused budget returns with `ads_withdraw`.
`ads_prepaid` and `financing_payable` are guarded non-negative by a trigger on
`ledger_accounts` (independent of which version of `post_ledger_transaction` is
live).

**Auction**: generalised second price with a reserve, bid-only. Eligible
campaigns (active, seller active and flagged, balance ≥ bid, today's spend + bid
≤ daily budget, product live, in stock, shop published) are ranked by bid, one
slot per seller; slot *i* pays `min(own bid, next bid + 1)`, never below the
market's `min_bid_minor`. Quality does not enter the rank yet: there is no
click-through history to estimate it, and a guessed quality score would be an
unexplainable price. Revisit when `ad_clicks` has volume.

**Clicks**: the sponsored card links to `/api/ads/click?t=<token>`, an HMAC
token (same construction and `ATTRIBUTION_SECRET` as campaign attribution, with
a separate key domain) carrying campaign, product, auction price and time
(6-hour life). Billing: token verifies → not a crawler/prefetch
(`campaigns/bots.ts`) → ≤ 20 billable clicks per IP per hour → advertiser's flag
still on → `record_ad_click` under the campaign's row lock: one billed click per
campaign per viewer per UTC day, price capped at the current bid, daily budget
enforced, and the campaign goes `out_of_funds` when the balance cannot pay its
bid (back to `active` on top-up). The viewer key is an HMAC of IP + user agent +
campaign, not the visitor cookie: a cookie is client-chosen, so rotating it
would let a competitor drain another seller's budget. Carrier NAT undercounts
distinct viewers — the direction a seller can live with.

**Placement**: a clearly labelled "Sponsored" section (and badge on every card,
`rel="sponsored"`) on `/discover` and the country pages, for the chosen or
geolocated market, not shown against a search (no relevance ranking yet).

### Invariants

`check_financial_product_invariants()` asserts the product tables and the
ledger agree (financing_payable = swept − remitted − fee share per seller; fee
revenue; sweeps sum; repaid means fully swept; disbursement postings = disbursed
principal; `ads_revenue` = billed clicks; no negative product balances). Every
pgTAP money path (085–088) also asserts `check_ledger_invariants()` is empty.

## Consequences

### Positive
- Three revenue lines with no change to capture, release, refund or payout code.
- Every rule is in SQL, parameterised per market, testable with pgTAP.
- No partner integration is on the critical path: sandbox for QA, not_configured
  in production until contracts exist.

### Negative
- A second clearing concept (`partner_clearing`) that finance must reconcile
  against the partner's statements.
- Reconciliation (`record_ledger_reconciliation`) does not yet count
  `financing_payable` or `ads_prepaid` in seller liability, and BNPL captures
  land in `processor_clearing` although the partner's cash lands in the bank.
- One lending partner per currency (`partner_clearing` has no partner dimension).

### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Regulatory: facilitating credit (BoG, CBN, BCEAO) | Med | High | Partner-funded only; counsel sign-off per market before `financing_policies.enabled` / `bnpl` flag |
| Seller withdraws in the sweep gap | Med | Low | 5-minute tick after a daily release; shortfall recorded; partner carries RBF risk |
| Partner funds but our posting fails | Low | Med | Advance stays `accepted`, never cancelled on a network error; partner webhook replays; operator view |
| Click fraud draining budgets | Med | Med | Signed tokens, bot filter, per-IP limit, per-viewer-per-day dedupe, daily budget cap |
| Sponsored slots degrade Discover | Med | Med | Flag gate at ~10k WAS, 3 slots max, never against a search, clear labelling |
| BNPL refunds | Med | Med | Refund routing is Paystack-only today; BNPL refunds need partner API + router work before `bnpl` leaves pilot |
