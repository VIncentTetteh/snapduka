# SnapDuka Growth and Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all P1 and P2 requirements in the SnapDuka PRD while preserving seller ownership, tenant isolation, mobile usability, and configurable external providers.

**Architecture:** Add six bounded modules over shared entitlement, audit, event, and adapter foundations. Database migrations own invariants and RLS; Next.js server actions and route handlers enforce capabilities; React pages provide mobile-first self-service workflows. External provider behavior remains behind typed adapters with functional manual/default implementations.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/PostgreSQL with pgTAP, Paystack, Vitest, Playwright, PWA APIs.

---

### Task 1: Shared Growth Schema and Entitlement Service

**Files:**
- Create: `supabase/migrations/202606130011_growth_core.sql`
- Create: `supabase/tests/database/006_growth_core.test.sql`
- Create: `src/lib/billing/entitlements.ts`
- Test: `src/lib/billing/entitlements.test.ts`

- [ ] Write failing tests proving typed boolean/numeric entitlement checks,
  current-plan resolution, immutable historical snapshots, downgrade read-only
  behavior, and seller-isolated billing tables.
- [ ] Run `pnpm vitest run src/lib/billing/entitlements.test.ts` and confirm the
  missing module failure.
- [ ] Add plan price, subscription, subscription event, billing grace, feature
  usage, and current-entitlement SQL records with forced RLS.
- [ ] Implement `resolveEntitlement`, `hasCapability`, and `withinLimit` using a
  normalized entitlement snapshot.
- [ ] Run unit tests, `pnpm db:reset`, and pgTAP; expect all assertions to pass.
- [ ] Commit with `feat: add Growth entitlements and billing state`.

### Task 2: Paid Plans and Subscription Management

**Files:**
- Create: `src/lib/billing/subscriptions.ts`
- Test: `src/lib/billing/subscriptions.test.ts`
- Create: `src/app/(seller)/dashboard/settings/billing/page.tsx`
- Create: `src/app/(seller)/dashboard/settings/billing/actions.ts`
- Create: `src/app/api/payments/paystack/subscription-webhook/route.ts`

- [ ] Write failing state-transition and webhook-idempotency tests for
  `trialing`, `active`, `past_due`, `grace`, `cancelled`, and `expired`.
- [ ] Implement configurable plan selection, Paystack subscription references,
  separate fee explanations, grace recovery, cancellation, and downgrade
  preservation.
- [ ] Add billing page actions protected by owner permission.
- [ ] Verify duplicate and out-of-order webhook behavior.
- [ ] Commit with `feat: add configurable paid subscriptions`.

### Task 3: Branding, Themes, and Custom Domains

**Files:**
- Create: `supabase/migrations/202606130012_branding_domains.sql`
- Create: `src/lib/shops/branding.ts`
- Test: `src/lib/shops/branding.test.ts`
- Create: `src/lib/domains/verification.ts`
- Test: `src/lib/domains/verification.test.ts`
- Create: `src/app/(seller)/dashboard/settings/branding/page.tsx`
- Create: `src/app/(seller)/dashboard/settings/branding/actions.ts`
- Modify: `src/app/(storefront)/[slug]/page.tsx`
- Modify: `src/proxy.ts`

- [ ] Test constrained theme tokens, invalid color rejection, entitlement gates,
  DNS challenge state, verified-host lookup, and fallback URL behavior.
- [ ] Add branding/domain tables with RLS and auditable state changes.
- [ ] Render only performance-safe theme tokens and seller assets.
- [ ] Route verified hosts to shops while preserving `/<slug>` fallback.
- [ ] Commit with `feat: add shop branding and custom domains`.

### Task 4: Promotions, Campaign Links, and Checkout Attribution

**Files:**
- Create: `supabase/migrations/202606130013_growth_marketing.sql`
- Create: `src/lib/promotions/discounts.ts`
- Test: `src/lib/promotions/discounts.test.ts`
- Create: `src/lib/campaigns/links.ts`
- Test: `src/lib/campaigns/links.test.ts`
- Create: `src/app/(seller)/dashboard/growth/promotions/page.tsx`
- Create: `src/app/(seller)/dashboard/growth/campaigns/page.tsx`
- Modify: `src/app/api/checkout/quote/route.ts`
- Modify: `src/app/api/checkout/orders/route.ts`
- Modify: `supabase/migrations/202606120006_orders.sql`

- [ ] Test fixed/percentage math, scope, windows, minimums, limits, concurrent
  redemption, snapshot data, and campaign token normalization.
- [ ] Add promotion, redemption, campaign, attribution, and order snapshot
  records with server-side validation.
- [ ] Carry campaign and promotion context through storefront, checkout, order,
  and completed-order analytics.
- [ ] Add seller management pages and caption/story-card output.
- [ ] Commit with `feat: add promotions and campaign attribution`.

### Task 5: Customer CRM, Consent-Aware Retention, and Push

**Files:**
- Create: `supabase/migrations/202606130014_retention.sql`
- Create: `src/lib/customers/segments.ts`
- Test: `src/lib/customers/segments.test.ts`
- Create: `src/lib/marketing/eligibility.ts`
- Test: `src/lib/marketing/eligibility.test.ts`
- Create: `src/app/(seller)/dashboard/customers/page.tsx`
- Create: `src/app/(seller)/dashboard/customers/[customerId]/page.tsx`
- Create: `src/app/(seller)/dashboard/growth/broadcasts/page.tsx`
- Create: `src/app/api/restock/route.ts`
- Create: `src/app/api/checkout/abandoned/route.ts`
- Create: `src/app/api/push/subscribe/route.ts`

- [ ] Test customer aggregates, segment rules, consent withdrawal after queueing,
  request scope, frequency caps, unsubscribe, and entitlement gates.
- [ ] Add segment, campaign, delivery, restock, abandoned checkout,
  notification preference, and push subscription records with RLS.
- [ ] Build customer directory/detail, segment and broadcast workflows.
- [ ] Enqueue scoped restock and abandoned reminders; keep push supplementary.
- [ ] Commit with `feat: add consent-aware customer retention`.

### Task 6: Bulk Actions, Exports, Analytics, Reconciliation, and Risk

**Files:**
- Create: `supabase/migrations/202606130015_growth_operations.sql`
- Create: `src/lib/analytics/advanced.ts`
- Test: `src/lib/analytics/advanced.test.ts`
- Create: `src/lib/exports/csv.ts`
- Test: `src/lib/exports/csv.test.ts`
- Create: `src/lib/payments/reconciliation.ts`
- Test: `src/lib/payments/reconciliation.test.ts`
- Create: `src/lib/risk/signals.ts`
- Test: `src/lib/risk/signals.test.ts`
- Create: `src/app/api/exports/orders/route.ts`
- Create: `src/app/(seller)/dashboard/growth/insights/page.tsx`
- Create: `src/app/(seller)/dashboard/settings/notifications/page.tsx`
- Modify: seller product/order pages for bulk actions.

- [ ] Test CSV escaping/isolation, bulk per-item results, funnels, top products,
  repeat rate, average order value, reconciliation mismatch classes, and
  non-punitive risk thresholds.
- [ ] Add export, settlement, preference, and risk records with RLS.
- [ ] Implement advanced insight ranges and definitions.
- [ ] Implement filtered export and constrained bulk mutations.
- [ ] Commit with `feat: add Growth operations and insights`.

### Task 7: French and Côte d'Ivoire

**Files:**
- Create: `supabase/migrations/202606130016_cote_divoire.sql`
- Create: `src/lib/i18n/en.ts`
- Create: `src/lib/i18n/fr.ts`
- Create: `src/lib/i18n/index.ts`
- Test: `src/lib/i18n/index.test.ts`
- Modify: `src/lib/countries/types.ts`
- Modify: `src/lib/countries/config.ts`
- Modify: `src/proxy.ts`
- Modify: core seller/storefront/checkout/receipt components.

- [ ] Test dictionary parity, locale fallback, XOF zero-decimal formatting,
  `+225` phone normalization, address labels, and payment-channel filtering.
- [ ] Extend database enums/configuration for `CI` and `XOF`.
- [ ] Add locale negotiation and English/French dictionaries for all critical
  journeys and transactional templates.
- [ ] Run French mobile acceptance flow.
- [ ] Commit with `feat: add French and Cote d'Ivoire support`.

### Task 8: Seller Teams and Permissions

**Files:**
- Create: `supabase/migrations/202606130017_teams.sql`
- Create: `supabase/tests/database/007_teams.test.sql`
- Create: `src/lib/auth/permissions.ts`
- Test: `src/lib/auth/permissions.test.ts`
- Modify: `src/lib/auth/actor.ts`
- Create: `src/app/(seller)/dashboard/settings/team/page.tsx`
- Create: `src/app/(seller)/dashboard/settings/team/actions.ts`
- Create: `src/app/team/invitations/[token]/page.tsx`

- [ ] Test the full role matrix, invite expiry/reuse/email checks, seat limits,
  owner protection, immediate revocation, and cross-seller denial.
- [ ] Add team membership/invitation records and capability-aware RLS helpers.
- [ ] Resolve actors through ownership or active membership.
- [ ] Protect pages, actions, and APIs with explicit permissions.
- [ ] Commit with `feat: add seller teams and role permissions`.

### Task 9: Courier Adapter and Shipment Workflow

**Files:**
- Create: `supabase/migrations/202606130018_couriers.sql`
- Create: `src/lib/couriers/types.ts`
- Create: `src/lib/couriers/manual.ts`
- Create: `src/lib/couriers/registry.ts`
- Test: `src/lib/couriers/contract.test.ts`
- Create: `src/app/(seller)/dashboard/orders/[orderId]/shipping/page.tsx`
- Create: `src/app/api/couriers/quotes/route.ts`
- Create: `src/app/api/couriers/book/route.ts`
- Create: `src/app/api/couriers/webhook/[provider]/route.ts`

- [ ] Write adapter contract tests for quote, expiry, book, cancel, label, and
  tracking.
- [ ] Add courier connection, quote, shipment, event, and label records.
- [ ] Implement the functional manual provider and registry for HTTP providers.
- [ ] Add seller shipping workflow and buyer-safe tracking projection.
- [ ] Commit with `feat: add courier quotes booking and tracking`.

### Task 10: Public API, Outbound Webhooks, and Automations

**Files:**
- Create: `supabase/migrations/202606130019_integrations.sql`
- Create: `src/lib/api-keys/keys.ts`
- Test: `src/lib/api-keys/keys.test.ts`
- Create: `src/lib/webhooks/signing.ts`
- Test: `src/lib/webhooks/signing.test.ts`
- Create: `src/lib/automation/engine.ts`
- Test: `src/lib/automation/engine.test.ts`
- Create: `src/app/api/v1/products/route.ts`
- Create: `src/app/api/v1/orders/route.ts`
- Create: `src/app/api/v1/customers/route.ts`
- Create: `src/app/api/v1/fulfillment/route.ts`
- Create: `src/app/(seller)/dashboard/settings/developers/page.tsx`
- Create: `src/app/api/internal/integrations/process/route.ts`

- [ ] Test one-time key display, hashing, scopes, rotation, pagination, rate
  limits, HMAC signatures, retries, dead letters, automation idempotency,
  recursion depth, consent, and tenant isolation.
- [ ] Add API key, request log, webhook, automation, and integration tables.
- [ ] Implement `/api/v1` authentication and scoped endpoints.
- [ ] Implement outbound delivery processor and constrained automation actions.
- [ ] Commit with `feat: add public APIs webhooks and automation`.

### Task 11: Opt-In Buyer Discovery

**Files:**
- Create: `supabase/migrations/202606130020_discovery.sql`
- Create: `src/lib/discovery/search.ts`
- Test: `src/lib/discovery/search.test.ts`
- Create: `src/app/discover/page.tsx`
- Create: `src/app/discover/[country]/page.tsx`
- Create: `src/app/(seller)/dashboard/settings/discovery/page.tsx`
- Create: `src/app/(seller)/dashboard/settings/discovery/actions.ts`

- [ ] Test explicit opt-in/out, deterministic ranking, filters, suspension,
  stale records, operator removal, campaign attribution, and no buyer PII.
- [ ] Add discovery preferences and projection records with public-safe RLS.
- [ ] Implement search/filter pages and seller opt-in controls.
- [ ] Preserve single-seller cart and seller-owned checkout.
- [ ] Commit with `feat: add opt-in buyer discovery`.

### Task 12: Full Traceability, Acceptance, Hosted Migration, and Release

**Files:**
- Modify: `docs/requirements/foundation-traceability.md`
- Create: `docs/requirements/growth-scale-traceability.md`
- Modify: `scripts/check-traceability.mjs`
- Create: `tests/e2e/growth-scale.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/database.yml`
- Modify: `docs/runbooks/deployment.md`

- [ ] Map every P1/P2 requirement to migration, implementation, and test
  evidence; make the traceability script fail on omissions.
- [ ] Add E2E journeys for promotion checkout, CRM withdrawal, French/XOF,
  team permissions, courier manual booking, API/webhook, automation, and
  discovery.
- [ ] Run lint, typecheck, unit tests, traceability, clean database reset,
  pgTAP, E2E, build, and Lighthouse.
- [ ] Push migrations 011–020 to hosted Supabase and query authoritative schema
  evidence.
- [ ] Run hosted public/API smoke tests and security isolation checks.
- [ ] Update deployment environment/provider instructions.
- [ ] Commit with `chore: complete Growth and Scale release readiness`.
