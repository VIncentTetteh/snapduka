# ADR-0003: Payment provider routing and pre-authorisation failover

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

Every checkout went to Paystack. Mobile money success in Ghana varies by network
and hour, and a checkout that cannot start is a lost sale. A second provider
(Hubtel or MTN MoMo direct) is planned but has no merchant agreement yet.

## Decision

- A provider **registry** (`src/lib/payments/providers/registry.ts`) lists each
  provider's countries, currencies, whether credentials are present, and its
  adapter. New providers require a `provider:<id>` feature flag; Paystack does not.
- A **router** returns healthy candidates in preference order. Health is a
  rolling 15-minute window per provider and country (`provider_health`); ≥10
  attempts with a failure majority opens the circuit for 10 minutes.
- **Failover happens only when initialisation fails**, before the buyer is sent
  to authorise. A pending MoMo prompt is never retried on another provider.
  Each attempt is its own `payment_attempts` row with its own reference and a
  `route_reason`.
- Sellers still on the legacy subaccount split route to Paystack only.

## Consequences

### Positive
- Adding a provider is data plus one adapter; failover is observable per attempt.

### Negative
- Until a second provider is contracted, routing only adds a health check.
- Per-provider webhook normalisation and clearing accounts are still to do when
  the second provider lands.

### Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Double charge across providers | Low | High | Failover only before authorisation; distinct references |
| Health lookup outage blocks checkout | Low | High | Lookup failure treated as available |
