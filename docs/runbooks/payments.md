# Payments

Paystack initialization uses the persisted order total, currency, buyer email and a unique reference. Under `country_configs.settlement_mode = 'subaccount'` it also sends the seller's subaccount so Paystack splits at charge time; under `'ledger'` no subaccount is sent and the full amount lands in SnapDuka's main account. A browser redirect is not payment evidence.

Payment confirmation requires a valid `x-paystack-signature` or server-side verification. Webhooks are idempotent through `provider_events(provider,event_key)`. Amount, currency, and reference must match the recorded attempt.

**Capture is guarded per order, not per event.** The webhook and the verify route reach `apply_paystack_success` under different event keys (`charge.success:{id}` and `verify:{reference}`), so the event gate alone cannot dedupe them. Three things prevent a double credit: `orders.payment_status = 'paid'` short-circuits, `order_settlements.order_id` is unique, and the ledger transaction key is `charge_capture:{order_id}`. Do not remove any of them.

For an outage:

1. Keep affected orders in unpaid or pending state.
2. Offer enabled offline methods without changing an existing payment result.
3. Inspect pending attempts and Paystack status.
4. Replay signed webhooks or reconcile through the verify endpoint.
5. Never manually mark paid without provider evidence or documented offline payment evidence.

Refund initiation creates a processing refund. Completion must follow provider evidence. A refund reaching `completed` claws the seller's share back out of the ledger — taking from pending first, then available — and returns SnapDuka's fee pro-rata at the rate snapshotted on `order_settlements`, never the current configured rate.

---

## Withdrawals

**Status as shipped: every market is still `settlement_mode = 'subaccount'` with
`payouts_enabled = false`.** Payments split to seller subaccounts exactly as
before, the ledger tables are empty, and no seller can withdraw. Everything
below describes the `ledger` mode, which is built and tested but not switched
on. Cutover is one row per market and is reversible by one more.

The remaining blocker is not code: Paystack refuses transfers on this account
with *"You cannot initiate third party payouts as a starter business."*
Do not flip `settlement_mode` before that is lifted — money would accumulate in
wallets sellers cannot withdraw from, which is strictly worse for them than the
split, where Paystack pays them directly.

Background: `docs/adr/0001-pooled-account-and-seller-ledger.md`.

### Preconditions before enabling a market

1. **Disable main-account auto-settlement at Paystack.** Transfers spend the Paystack *balance*. If Paystack keeps sweeping that balance to SnapDuka's bank, withdrawals fail with insufficient funds while the ledger correctly insists sellers are owed. This is the most important operational setting in the whole flow.
2. **Disable transfer OTP.** A transfer returning `status: 'otp'` is treated as a hard failure and never auto-solved, so payouts halt until it is turned off.
3. Set `country_configs.payouts_enabled = true` only after one real transfer has been proven end to end.

### The flow

`request_seller_payout` → reserve → `claim_payout_for_transfer` → Paystack `/transfer` → `record_payout_transfer` → `transfer.success` webhook → settle.

Money moves in the ledger at exactly two points: the reservation at request time, and the webhook. **Recording a transfer posts nothing** — a `pending` transfer is not evidence money moved, and Ghanaian bank and mobile money transfers fail asynchronously.

### Diagnosis

```sql
-- Where is a payout stuck?
select reference, status, claimed_at, provider_transfer_code, failure_reason
from public.payout_requests
where status not in ('paid','rejected','cancelled')
order by created_at desc;

-- What does the ledger say a seller is owed?
select kind, currency, balance_minor, status
from public.ledger_accounts where owner_seller_account_id = '<seller>';

-- Is the whole book healthy? An empty result means yes.
select * from public.check_ledger_invariants();

-- Latest reconciliation per currency.
select * from public.ledger_reconciliations order by run_at desc limit 5;
```

| Symptom | Cause | Action |
|---|---|---|
| `processing` for hours with no `provider_transfer_code` | Crashed between the Paystack call and our write | The execute worker's sweeper resolves it via `GET /transfer/verify/:reference` within ~5 minutes. If not, run the worker manually |
| `needs_operator` | Paystack returned `status: 'otp'` | Transfer OTP has been re-enabled on the integration. Turn it off; **never** attempt to solve the OTP automatically |
| Transfer fails with insufficient balance | Float — auto-settlement is probably on, or withdrawals exceed what is held | Compare `processor_clearing` against the real Paystack balance; fix settlement settings before re-enabling |
| Seller balance negative, account `in_arrears` | A refund landed after they withdrew | Expected. It blocks new withdrawals and nets off future sales. Write it off only if genuinely uncollectible, via the operator RPC with a reason |
| `payouts_enabled` flipped to false on its own | The reconciler detected drift | Read `ledger_reconciliations.detail`. Do not re-enable until the drift is explained |

### Rules

- **Never** UPDATE or DELETE a ledger row — they are immutable and the trigger refuses. Corrections are new balancing transactions.
- **Never** set `payout_requests.status = 'paid'` by hand. Only the provider webhook may declare that money moved; operators can approve, reject or cancel and nothing else.
- On drift, nothing auto-corrects. Investigate first.

## SnapDuka Protect and the trust-and-money release (2026-09-25)

Everything below ships dark. Nothing moves until an operator turns it on.

### Before any real money is held (go-live checklist)
1. **Legal**: written opinion on holding buyer funds under the Payment Systems
   and Services Act 2019 (Act 987) for the market. No `protect_enabled = true`
   without it.
2. **Paystack**: confirm the pooled-account marketplace model and transfer rate
   limits in writing.
3. **Chargeback payload**: raise a sandbox dispute and confirm the fields
   `apply_paystack_dispute_event` reads (`data.id`, `data.transaction.reference`,
   `data.refund_amount`, `data.resolution` = `declined` when the merchant wins).
4. **Reconciliation**: pilot sellers run on ledger settlement for 14 days with
   `ledger_reconciliations` showing no invariant failures.
5. **Rollback drill**: set a pilot seller's `settlement_mode_override` back to
   `subaccount` in staging and confirm new orders split to their subaccount.
6. **Alerts**: Sentry cron monitors for `snapduka-protect-sweep`,
   `snapduka-domain-events`, `snapduka-execute-payouts`, `snapduka-reconcile-ledger`.

### Turning Protect on for a pilot cohort (Ghana)
```sql
-- 1. Move the pilot seller onto ledger settlement.
update public.seller_accounts set settlement_mode_override = 'ledger' where id = '<seller>';
-- 2. Market switch (limits already seeded: GH₵2,000 per order, GH₵50,000 held).
update public.country_configs set protect_enabled = true, payouts_enabled = true where country = 'GH';
-- 3. Rollout flag for that seller only.
insert into public.feature_flags (key, seller_account_id, enabled) values ('protect', '<seller>', true);
```
Once Protect is live for the market, switch the trust-led landing page on for
it (visitors there then see "Get paid before you ship"; everyone else keeps the
classic page, and the page falls back to classic by itself if Protect is off):
```sql
insert into public.feature_flags (key, country_code, enabled) values ('new_homepage', 'GH', true);
```
Add real pilot-seller quotes, with their permission, to
`src/components/landing/testimonials.ts`; the section stays hidden until then.

Kill switch: `update feature_flags set enabled = false where key = 'protect';`
(orders already protected continue through their lifecycle).

### Daily operations
- **Disputes**: `/admin/cases` → a Protect order shows "SnapDuka Protect dispute".
  Release pays the seller; Refund returns the full total via Paystack. Both
  require a written finding and write an audit event.
- **Dispatch overdue**: `protect.dispatch_overdue` notifies buyer and seller;
  follow up with the seller, refund from the case if it will not ship.
- **Seller debt**: `/admin/sellers/<id>` shows negative balances (refund or
  chargeback after withdrawal). Write-offs move the loss to bad debt and are
  irreversible.
- **Unheld Protect** (`protect.unheld`): a buyer paid for Protect but the seller
  was not on ledger settlement at capture. Refund the Protect fee manually and
  check why the seller's mode changed.

### Instant withdrawals
Flag `instant_payout`. Eligibility (enforced in SQL): verified seller, trust tier
bronze or above, no open chargeback or Protect dispute. Standard withdrawals go
out in the 09:00 GMT batch.

## Stock financing, BNPL and promoted listings (ADR-0014)

All three ship dark behind flags (`stock_financing`, `bnpl`,
`promoted_listings`) and, for the first two, need a contracted partner. Nothing
here moves money until both are true.

### Stock financing

- **Turning a market on**: counsel sign-off for the market → partner contract →
  set the partner's credit numbers in `financing_policies` (thresholds, offer %,
  cap, `fee_bps`, `sweep_bps`, `partner`) → `enabled = true` → flag on for a
  pilot cohort. Changing the seller-facing terms text means bumping
  `terms_version` in the policy AND `FINANCING_TERMS_VERSION` in
  `src/lib/financing/terms.ts` in the same deploy (acceptance is refused while
  they differ).
- **Jobs**: `snapduka-financing-repayments` (SQL, every 5 min) sweeps new hold
  releases and remits; `snapduka-financing-settle` (04:25 daily) pays the
  partner through its adapter. Check `select * from cron.job_run_details` for
  both.
- **Daily check** (`/admin/capital`): `check_financial_product_invariants()`
  must be empty; `financing_partner_amounts_due()` shows what is owed to each
  partner; `partner_clearing` should return to 0 once funding and transfers are
  recorded.
- **Advance stuck in `accepted`**: the partner call failed or is pending.
  Ask the partner. Funded → wait for / replay their `advance.funded` webhook
  (idempotent). Not funded → cancel it from `/admin/capital`
  (`cancel_financing_advance`). Never post a disbursement by hand.
- **Partner cash landed / we paid the partner**: record it from
  `/admin/capital` with the bank reference (`record_partner_settlement`). It
  refuses to record more received than was disbursed, or more paid than was
  remitted.
- **Partner declares default / write-off**: close the advance
  (`close_financing_advance`). Sweeping stops; already-swept money is still
  remitted. SnapDuka books no bad debt: the remainder is between the seller and
  the partner.
- **Diagnosis**: `select * from financing_sweeps where advance_id = …` shows
  every release examined, its target and the `shortfall_minor` where the
  seller's balance could not cover it.

### BNPL

- Webhook: `/api/payments/bnpl/webhook/<partner>`; the partner's approval goes
  through the ordinary capture (`apply_paystack_success`, event key
  `bnpl:<partner>:<event id>`). An order paid by BNPL looks like any paid online
  order from there on.
- **Refunds are not wired**: the refund route calls Paystack. Before `bnpl`
  leaves pilot, add the partner's refund API to the refund router.

### Promoted listings

- Flag on per country (viewer side) and per seller (advertiser side).
- `/admin/ads` shows campaigns and spend. `ads_revenue` must equal the sum of
  `ad_clicks.price_minor` (checked by `check_financial_product_invariants`).
- **A seller disputes clicks**: `select * from ad_clicks where campaign_id = …`
  (billed clicks only; bots, repeats and over-budget clicks were never stored).
  A goodwill credit is an operator ledger adjustment back to `ads_prepaid`
  (reversing `ads_click` postings), never an edit to `ad_clicks`.
- **Kill switch**: turn `promoted_listings` off globally. Links already on
  screen stop billing on the next click (the flag is re-checked at click time).
