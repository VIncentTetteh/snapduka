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

Only relevant where `settlement_mode = 'ledger'`. Background: `docs/adr/0001-pooled-account-and-seller-ledger.md`.

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
