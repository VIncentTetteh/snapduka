# ADR-0004: Transactional outbox for side effects of state changes

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

Side effects (buyer notification, integration events) were fired from
TypeScript after a change committed, by whichever route made it. Routes that
forgot — the public fulfilment API, the courier webhook — left buyers
uninformed, with no trace. `financial_events` was written but never read.

## Decision

- `public.domain_events` is written by definer functions **in the same
  transaction** as the change (`emit_domain_event`, optional dedupe key).
- `/api/internal/events/process` (pg_cron every minute, named
  `snapduka-domain-events`) claims bounded batches with `for update skip locked`
  and runs handlers registered in `src/lib/events/register.ts`. Delivery is at
  least once; handlers are idempotent. Ten failed attempts stop retries.
- A plain table, not pgmq: no extension, visible to pgTAP, ample for one event
  per state change. Secrets carried in an event (a delivery code) are redacted
  once delivered.
- `financial_events` is left in place for history and superseded; new money
  events go through the outbox.

## Consequences

### Positive
- An event exists if and only if its change committed.

### Negative
- Up to a minute of latency unless the producer kicks the worker.

### Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Handler not idempotent | Med | Med | Documented contract; handlers test replays |
| Backlog growth | Low | Med | Bounded batches; Sentry cron monitor on the worker |
