# SnapDuka End-to-End Delivery Roadmap

> **For agentic workers:** Each increment requires its own implementation plan and must pass its exit gate before the next increment starts.

**Goal:** Deliver the complete SnapDuka PRD as a sequence of deployable, measurable product increments.

**Architecture:** Start with a modular Next.js monolith backed by Supabase Postgres, Auth, and Storage. Keep commerce rules in typed domain modules, authorization in Postgres RLS, external-provider calls behind adapters, and asynchronous work behind durable database queues so modules can be extracted later only when scale requires it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS 4, Supabase, Paystack, Zod, Vitest, Playwright, pgTAP, pnpm, Vercel.

---

## Delivery Principles

- Build vertical slices that create user value, not isolated technical layers.
- Treat Ghana and Nigeria as explicit country configurations from the first migration.
- Use server-rendered public storefronts and progressively enhanced client interactions.
- Keep payment, fulfillment, refund, dispute, and notification states independent.
- Confirm online payments through signed Paystack webhooks or server verification, never browser redirects alone.
- Add every schema change through migrations and test tenant isolation with pgTAP.
- Instrument completed orders and the supporting launch metrics from the first production release.
- Ship through preview/staging before production and keep production migrations backward compatible.

## Increment 1: Foundation Commerce Loop

Build:

- Application scaffold, CI, local Supabase, environments, observability baseline.
- Seller authentication, onboarding, country configuration, shop publishing.
- Product catalog, media compression, variants, inventory, collections.
- Public storefront, social metadata, product sharing, QR codes.
- Single-seller cart, guest checkout, delivery zones, pickup, offline orders.
- Paystack subaccounts, transaction initialization, signed webhooks, verification, refunds.
- Seller commerce cockpit, order workflow, secure buyer receipt/tracking.
- In-app/email notification outbox, buyer-initiated WhatsApp handoff.
- Basic analytics, consent records, disputes, risk/admin operations.

Exit gate:

- All P0 requirements in the PRD are mapped to passing automated or documented acceptance tests.
- Ghana and Nigeria purchase paths pass in Paystack test mode.
- RLS tests prove cross-seller isolation.
- P75 public storefront content renders within the PRD mobile performance budget.
- Staging backup restoration and production deployment runbooks are verified.

## Increment 2: Pilot Hardening

Build:

- Guided onboarding telemetry and support tooling.
- Payment reconciliation, failed-event replay, notification retries.
- Inventory reservation expiry and operational alerts.
- Fraud signals, rate-limit tuning, account restrictions, policy enforcement.
- Accessibility and low-bandwidth fixes from pilot evidence.
- Data-retention jobs and buyer privacy request workflow.

Exit gate:

- Twenty pilot sellers complete real or controlled-live orders.
- No unresolved severity-one authorization or payment defects.
- Payment pending states reconcile automatically or create actionable operator cases.
- Support can resolve verification, payment, fulfillment, and dispute cases without direct database edits.

## Increment 3: Public Foundation Launch

Build:

- Public self-service signup.
- Production policy pages and support operations.
- Seller education, onboarding recovery, and launch communications.
- Launch dashboards for activation, conversion, payment, fulfillment, disputes, retention, and performance.

Exit gate:

- 100 active sellers and 500 completed orders within 90 days.
- Launch metrics have documented definitions and trustworthy event coverage.
- A formal review decides whether Growth work begins or Foundation requires another hardening cycle.

## Increment 4: Growth Commerce

Build:

- Paid subscriptions, configurable plan entitlements, grace periods.
- Custom domains and expanded shop branding.
- Coupons, campaign links, attribution, conversion funnels.
- Customer directory, consent-aware segments, restock messages.
- Abandoned checkout recovery and constrained broadcasts.
- Bulk product/order actions, exports, settlement reconciliation.

Exit gate:

- Paid-plan billing and downgrade behavior pass end-to-end tests.
- Marketing sends enforce consent, frequency limits, and unsubscribe rules.
- Attribution and funnel metrics reconcile against order records.

## Increment 5: Regional and Operational Scale

Build:

- French localization and Côte d'Ivoire country/payment configuration.
- Courier adapters for quotes, booking, labels, and tracking.
- Seller team roles and permissions.
- Public API, outbound webhooks, accounting/operations integrations.
- Advanced automation with rate, consent, and plan controls.

Exit gate:

- French and English critical journeys pass localization review.
- Courier failure always falls back to seller-managed fulfillment.
- Team and API authorization pass expanded tenant-isolation tests.

## Increment 6: Optional Buyer Discovery

Build only after a separate approved specification:

- Seller opt-in discovery.
- Search, category browsing, ranking, moderation, and reporting.
- Buyer favorites or saved shops if evidence supports them.

Exit gate:

- Discovery produces incremental completed orders without materially harming seller ownership, trust, storefront performance, or support load.

## Plan Sequence

1. `2026-06-12-snapduka-foundation-implementation.md`
2. Pilot-hardening implementation plan after Increment 1 acceptance evidence.
3. Launch implementation plan after pilot review.
4. Growth implementation plan after the 90-day Foundation review.
5. Regional-scale implementation plan after Growth reliability review.
6. Buyer-discovery specification and plan only after explicit product approval.

