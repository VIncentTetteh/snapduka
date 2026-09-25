# ADR-0006: Feature flags and per-market rollout

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

Money features must reach internal accounts, then a pilot cohort, then a share
of one market, and be switchable off without a deploy. The only switches were
`country_configs` columns, per country and needing a migration.

## Decision

- `feature_flags` rows target one scope: a seller, a country, or global. The
  most specific row wins; `percentage` buckets sellers deterministically by a
  hash of (key, seller). A partial rollout with no seller is off.
- Evaluation lives in SQL (`evaluate_feature_flag`) and is service-role only;
  clients receive a resolved snapshot from the server. Lookup failure is "off".
- Keys are typed in `packages/core/src/flags` (`FLAG_KEYS`, plus
  `courier_booking:<id>` and `provider:<id>`).
- Market-level legal switches stay on `country_configs` (e.g. `protect_enabled`)
  so a market cannot be turned on by a flag alone.
- Rollout order for Ghana: internal → 20 pilot sellers → 10% → 100%. Nigeria
  (CBN) and Côte d'Ivoire (BCEAO) need their own legal sign-off before `protect`
  or ledger settlement is enabled.

## Consequences

### Positive
- Instant kill switch per seller or market; rollout plans invisible to sellers.

### Negative
- Two layers of switches (flag + market column) for money features, deliberately.
