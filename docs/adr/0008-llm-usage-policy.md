# ADR-0008: LLM usage, cost and data policy

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Decision
- Models: `claude-sonnet-5` for vision (Snap-to-list) and agent turns;
  `claude-haiku-4-5-20251001` for classification, captions and translation.
  Prompt caching for stable prompts (catalog summaries, category taxonomy).
- Every call writes `ai_runs` (tokens, cache hits, cost, latency, outcome),
  including refusals. A per-seller monthly budget by plan is checked before
  each call; a plan row may override the default.
- Models never decide money: prices come from `suggest_price` (market data),
  payments are confirmed only by provider webhooks, and drafts never publish
  without the seller.
- No API key → `not_configured`; features stay behind flags.
- Buyer messages sent to the model contain only the conversation and the shop's
  catalog; no buyer profile data. Disclosure of automation to buyers is required.
