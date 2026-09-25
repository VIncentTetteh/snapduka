# ADR-0013: Mobile offline cache and mutation queue

**Status**: Accepted
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Decision
- The TanStack Query cache persists to AsyncStorage by an allowlist of query
  roots, keyed to app version and user, cleared on sign-out, max age 24 h. Money
  and credential queries (payouts, wallet, earnings, API keys, links, KYC) are
  never persisted.
- A persisted, ordered mutation queue replays on reconnect with a client
  `Idempotency-Key`; the server (`withIdempotency`, `idempotency_keys`) replays
  the first result. Version conflicts are parked for the seller, never retried
  blindly. Payouts and KYC are never queued.
- Product creates use client-generated ids; queued edits send changed fields
  only so stock moved by orders is not overwritten.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Expired idempotency rows accumulate | Med | Low | Add a pg_cron sweep |
| Online product saves still send whole rows | Med | Med | Move to changed-fields saves |
