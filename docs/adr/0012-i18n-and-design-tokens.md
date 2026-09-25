# ADR-0012: One source for strings and design tokens

**Status**: Accepted
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Decision

- User-facing strings live in `packages/core/src/i18n/messages/{en,fr,pcm,tw}.ts`.
  Pidgin and Twi entries are machine drafts marked `needsReview` and fall back to
  English at runtime until a native reviewer clears them. `scripts/check-i18n.mjs`
  enforces key and placeholder parity in CI.
- The web `@theme` token block is generated from `packages/core/src/theme` by
  `scripts/gen-tokens.mjs` and checked in CI, ending hand-mirroring.
- The duplicate web copies under `src/lib/i18n` and `src/lib/countries` are removed.

## Consequences

- Translation quality depends on paid native reviewers; drafts never ship as
  reviewed copy.
