# Payments

Paystack initialization uses the persisted order total, currency, buyer email, unique reference, and seller subaccount. A browser redirect is not payment evidence.

Payment confirmation requires a valid `x-paystack-signature` or server-side verification. Webhooks are idempotent through `provider_events(provider,event_key)`. Amount, currency, and reference must match the recorded attempt.

For an outage:

1. Keep affected orders in unpaid or pending state.
2. Offer enabled offline methods without changing an existing payment result.
3. Inspect pending attempts and Paystack status.
4. Replay signed webhooks or reconcile through the verify endpoint.
5. Never manually mark paid without provider evidence or documented offline payment evidence.

Refund initiation creates a processing refund. Completion must follow provider evidence.
