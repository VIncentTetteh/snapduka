# ADR-0005: WhatsApp Cloud API and the shop assistant

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context
Sellers live in WhatsApp; SnapDuka only produced `wa.me` links and a generic
webhook that dead-lettered when unset.

## Decision
- **Meta Cloud API directly** (no BSP). One shared SnapDuka number to start; a
  conversation binds to a shop from a `SHOP-<slug_code>` prefix or storefront
  address. Embedded Signup for sellers' own numbers comes later.
- **Outbound**: free-form inside the 24-hour window, approved templates outside
  it (`wa_templates`, status must be `approved`). Twi and Pidgin have no Meta
  template language, so templates are English; Twi/Pidgin happen in session.
- **Inbound**: signed webhook (`X-Hub-Signature-256`), dedupe on the message id,
  `whatsapp.inbound` outbox event in the same transaction, per-conversation
  lease so one agent turn runs at a time.
- **Agent**: Haiku classifies language/intent/needs-human; Sonnet runs at most
  eight server-bound tool calls. Guardrails are enforced in code on the final
  reply: no price a tool did not return, no claim that payment succeeded;
  either sends the conversation to a person. The first reply discloses
  automation. Seller replies take over for 12 hours.
- **Voice**: a `Transcriber` interface, not configured until a vendor is chosen
  by Twi/Pidgin word error rate on real samples.

## Consequences / Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Template approval delays | High | Med | SMS fallback for every utility message |
| Weak Twi understanding | High | Med | Low-confidence hand-off; eval harness with native review |
| Marketing messages outside window fail | High | Low | No marketing template yet; broadcasts note the limit |
| Webhook secret in env, not Vault | Med | Med | Move to Vault before GA |
