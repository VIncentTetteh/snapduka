# SnapDuka Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the complete Foundation release: a Ghana/Nigeria seller can publish products, share a storefront, receive a guest order through Paystack or an offline method, fulfill it, notify the buyer, and resolve support cases.

**Architecture:** Use a modular Next.js App Router application with Server Components for read-heavy pages and Route Handlers or server actions for mutations. Supabase provides Auth, Postgres, Storage, RLS, and local development; domain modules own validation and state transitions; Paystack and notification providers are adapters; durable `provider_events` and `notification_jobs` tables make asynchronous processing idempotent and recoverable.

**Tech Stack:** pnpm, Node.js 22, Next.js 16.2.9, React 19.2.7, TypeScript 6.0.3, Tailwind CSS 4.3, Supabase JS 2.108, `@supabase/ssr` 0.12, Zod 4.4, Vitest 4.1, Playwright 1.60, pgTAP, Paystack REST API, Vercel.

**Authoritative requirements:** `docs/product/snapduka-product-requirements.md`, all P0 requirement IDs.

---

## File and Module Map

```text
src/
  app/
    (auth)/login/                 seller authentication
    (seller)/onboarding/          resumable setup
    (seller)/dashboard/           cockpit and seller operations
    (storefront)/[slug]/          public shop and product pages
    api/checkout/                 quote and order creation
    api/payments/paystack/        initialize, verify, webhook, refund
    api/orders/[token]/           secure buyer tracking/actions
    api/admin/                    protected operations endpoints
  components/
    ui/                           accessible primitives
    seller/                       cockpit, forms, order views
    storefront/                   shop, catalog, cart, checkout
  lib/
    auth/                         authenticated actor resolution
    countries/                    GH/NG configuration
    commerce/                     money, cart, quote, order transitions
    catalog/                      product, variant, inventory rules
    payments/                     provider interface and Paystack adapter
    fulfillment/                  zones, pickup, transition rules
    notifications/                outbox and channel adapters
    analytics/                    event contracts and metric queries
    support/                      disputes and risk actions
    supabase/                     browser, server, admin clients
  test/                           factories and integration helpers
supabase/
  config.toml
  migrations/                    schema, functions, RLS, seedable config
  seed.sql
  tests/database/                pgTAP constraints and RLS tests
tests/e2e/                       Playwright acceptance journeys
```

## Task 1: Repository Scaffold and Quality Gates

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Test: `src/app/page.test.tsx`

- [ ] **Step 1: Create the failing landing-page test**

```tsx
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

it("explains the seller value and offers a storefront action", () => {
  render(<HomePage />);
  expect(
    screen.getByRole("heading", { name: /turn social attention into completed orders/i }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /start selling/i })).toHaveAttribute(
    "href",
    "/login",
  );
});
```

- [ ] **Step 2: Add the pinned package manifest and configuration**

Use pnpm and pin the framework/provider major-minor versions established in
the plan header. Required scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:test": "supabase test db"
  }
}
```

Install runtime dependencies:

```bash
pnpm add next@16.2.9 react@19.2.7 react-dom@19.2.7 \
  @supabase/supabase-js@2.108.1 @supabase/ssr@0.12.0 zod@4.4.3
pnpm add -D typescript@6.0.3 tailwindcss@4.3.0 \
  vitest@4.1.8 @vitejs/plugin-react @testing-library/react \
  @testing-library/jest-dom jsdom eslint eslint-config-next \
  @playwright/test@1.60.0 supabase
```

- [ ] **Step 3: Implement the minimal mobile landing page**

Create a semantic page with the tested heading, seller CTA, buyer explanation,
and no client-side JavaScript. Set viewport metadata, Ghana/Nigeria description,
and a system-font CSS foundation with 44px minimum control height.

- [ ] **Step 4: Add CI**

CI must run on pull requests and pushes:

```yaml
- run: corepack enable
- run: pnpm install --frozen-lockfile
- run: pnpm lint
- run: pnpm typecheck
- run: pnpm test
- run: pnpm build
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git add package.json pnpm-lock.yaml next.config.ts tsconfig.json \
  postcss.config.mjs eslint.config.mjs vitest.config.ts playwright.config.ts \
  src .env.example .gitignore .github
git commit -m "chore: scaffold SnapDuka application"
```

Expected: all commands exit 0; the landing-page test passes.

## Task 2: Local Supabase, Core Schema, and Country Configuration

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202606120001_core.sql`
- Create: `supabase/seed.sql`
- Create: `supabase/tests/database/001_core.test.sql`
- Create: `src/lib/countries/types.ts`
- Create: `src/lib/countries/config.ts`
- Test: `src/lib/countries/config.test.ts`

- [ ] **Step 1: Test country configuration**

```ts
import { describe, expect, it } from "vitest";
import { getCountryConfig } from "./config";

describe("getCountryConfig", () => {
  it("returns Ghana defaults", () => {
    expect(getCountryConfig("GH")).toMatchObject({
      currency: "GHS",
      callingCode: "+233",
    });
  });

  it("returns Nigeria defaults", () => {
    expect(getCountryConfig("NG")).toMatchObject({
      currency: "NGN",
      callingCode: "+234",
    });
  });
});
```

- [ ] **Step 2: Implement typed GH/NG configuration**

```ts
export type CountryCode = "GH" | "NG";

export interface CountryConfig {
  code: CountryCode;
  currency: "GHS" | "NGN";
  callingCode: "+233" | "+234";
  addressFields: readonly ("line1" | "area" | "city" | "region")[];
}
```

Expose `getCountryConfig(code)` and reject unsupported codes rather than
falling back silently.

- [ ] **Step 3: Create the core migration**

The migration must:

- Enable `pgcrypto` and `pgtap`.
- Create enums for country, verification, shop, product, inventory, order,
  payment, fulfillment, refund, dispute, consent, notification, and actor type.
- Create `seller_accounts`, `shops`, `seller_verifications`,
  `payment_subaccounts`, `plans`, `seller_entitlements`, and
  `country_configs`.
- Store money as integer minor units plus ISO currency.
- Add timestamps, foreign keys, checks, and indexes for every hot lookup.
- Seed GH/GHS/+233 and NG/NGN/+234 configuration.
- Add `updated_at` triggers and immutable audit helpers.

- [ ] **Step 4: Add pgTAP structure tests**

Assert tables, enum checks, unique shop slug, one shop per seller in
Foundation, supported currency-country combinations, and no negative money
values.

- [ ] **Step 5: Run and commit**

```bash
pnpm supabase:start
pnpm db:reset
pnpm db:test
pnpm test src/lib/countries/config.test.ts
git add supabase src/lib/countries
git commit -m "feat: add country-aware commerce schema"
```

Expected: local stack starts, migrations apply, pgTAP and Vitest pass.

## Task 3: Supabase SSR Authentication and Tenant Isolation

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/auth/actor.ts`
- Create: `src/proxy.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/actions.ts`
- Create: `src/app/auth/confirm/route.ts`
- Create: `supabase/migrations/202606120002_rls.sql`
- Create: `supabase/tests/database/002_rls.test.sql`
- Test: `src/lib/auth/actor.test.ts`

- [ ] **Step 1: Test authenticated actor resolution**

Cover no user, user without seller account, active seller, suspended seller,
and operator role. Server authorization must use verified claims and database
membership, not a client-supplied seller ID.

- [ ] **Step 2: Implement browser/server/admin clients**

Use `@supabase/ssr` cookie clients. `admin.ts` must be server-only and must
throw during import when the service secret is unavailable. Never export the
admin client from a client-reachable module.

- [ ] **Step 3: Implement login and confirmation**

Support email/password login, email confirmation callback, logout, actionable
errors, and safe `next` redirects limited to same-origin paths.

- [ ] **Step 4: Add RLS policies**

Policies must prove:

- Public users can read only published shop/catalog fields.
- Sellers can read and mutate only rows owned through their authenticated
  `seller_account`.
- Suspended sellers cannot publish or accept new orders.
- Buyers cannot enumerate orders.
- Operator access uses an explicit operator role, never the public client.

- [ ] **Step 5: Verify and commit**

```bash
pnpm db:reset
pnpm db:test
pnpm test src/lib/auth/actor.test.ts
pnpm typecheck
git add src/lib/supabase src/lib/auth src/proxy.ts src/app/'(auth)' \
  src/app/auth supabase
git commit -m "feat: add seller authentication and RLS"
```

## Task 4: Resumable Seller Onboarding and Progressive Verification

**Files:**
- Create: `src/app/(seller)/onboarding/page.tsx`
- Create: `src/app/(seller)/onboarding/actions.ts`
- Create: `src/components/seller/onboarding-form.tsx`
- Create: `src/lib/auth/onboarding.ts`
- Create: `src/lib/payments/subaccounts.ts`
- Create: `supabase/migrations/202606120003_onboarding.sql`
- Test: `src/lib/auth/onboarding.test.ts`
- Test: `src/lib/payments/subaccounts.test.ts`

- [ ] **Step 1: Test onboarding progression**

Test the ordered milestones: account, shop identity, first product,
fulfillment, payment, preview/publish. A seller may save after each step and
resume at the first incomplete required milestone.

- [ ] **Step 2: Test Paystack subaccount eligibility**

The adapter must refuse creation until country, settlement details, policy
acceptance, and verification prerequisites are present. Duplicate calls must
return the existing subaccount.

- [ ] **Step 3: Implement onboarding**

Use server-side Zod validation and idempotent actions. Reserve slugs
transactionally. Expose verification states exactly as defined by ACC-007 and
never show a verified badge for stale or rejected checks.

- [ ] **Step 4: Implement the subaccount adapter**

Define:

```ts
export interface PaymentSubaccountProvider {
  create(input: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
    percentageCharge: number;
  }): Promise<{ providerId: string; subaccountCode: string }>;
}
```

Store provider IDs, status, request fingerprint, and safe response metadata.
Keep secret keys server-only.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test src/lib/auth/onboarding.test.ts \
  src/lib/payments/subaccounts.test.ts
pnpm typecheck
git add src supabase
git commit -m "feat: add resumable seller onboarding"
```

## Task 5: Catalog, Variants, Media, Collections, and Inventory

**Files:**
- Create: `supabase/migrations/202606120004_catalog.sql`
- Create: `src/lib/catalog/schema.ts`
- Create: `src/lib/catalog/inventory.ts`
- Create: `src/lib/catalog/images.ts`
- Create: `src/app/(seller)/dashboard/products/page.tsx`
- Create: `src/app/(seller)/dashboard/products/actions.ts`
- Create: `src/components/seller/product-form.tsx`
- Create: `src/components/seller/image-uploader.tsx`
- Create: `supabase/tests/database/003_catalog_rls.test.sql`
- Test: `src/lib/catalog/inventory.test.ts`
- Test: `src/lib/catalog/images.test.ts`

- [ ] **Step 1: Test product and inventory rules**

Cover finite stock, preorder, always-available, variant-specific prices,
nonnegative minor-unit money, invalid currency, sold-out display, and guarded
last-item reservation.

- [ ] **Step 2: Create catalog schema**

Create `products`, `product_variants`, `product_media`, `collections`,
`collection_products`, `inventory_movements`, and `stock_reservations`.
Historical orders must not cascade-delete product snapshots.

- [ ] **Step 3: Implement image processing**

Resize in-browser to a maximum 1000px edge, encode WebP when supported, strip
unneeded metadata, enforce count/type/size limits, and upload to
`<seller_id>/<product_id>/<uuid>.webp`. Preserve the draft and per-image retry
state after failure.

- [ ] **Step 4: Implement seller product management**

Support create, edit, duplicate, archive, hide, publish, sold-out, variant
editing, collection membership, preview, and stock adjustments. Every stock
change writes an inventory movement.

- [ ] **Step 5: Verify and commit**

```bash
pnpm db:reset
pnpm db:test
pnpm test src/lib/catalog
pnpm typecheck
git add src supabase
git commit -m "feat: add product catalog and inventory"
```

## Task 6: Public Storefront and Social Sharing

**Files:**
- Create: `src/app/(storefront)/[slug]/page.tsx`
- Create: `src/app/(storefront)/[slug]/products/[productId]/page.tsx`
- Create: `src/app/(storefront)/[slug]/opengraph-image.tsx`
- Create: `src/app/(storefront)/[slug]/not-found.tsx`
- Create: `src/components/storefront/shop-header.tsx`
- Create: `src/components/storefront/product-grid.tsx`
- Create: `src/components/storefront/share-actions.tsx`
- Create: `src/lib/storefront/queries.ts`
- Create: `src/lib/storefront/sharing.ts`
- Test: `src/lib/storefront/sharing.test.ts`
- Test: `tests/e2e/storefront.spec.ts`

- [ ] **Step 1: Test public visibility and sharing**

Test published/hidden/sold-out behavior, stable canonical links, WhatsApp share
URLs, device-share fallback, QR payloads, unknown slug, and suspended shop.

- [ ] **Step 2: Implement server-rendered storefront queries**

Fetch only published public columns through the public Supabase client.
Paginate catalog results, support search/collection filters, and revalidate
shop/catalog caches after seller mutations.

- [ ] **Step 3: Implement mobile storefront UI**

Render shop trust, fulfillment summary, policies, product price/stock/variants,
Buy Now, cart action, share action, and accessible empty/error states. Keep the
initial product page within the PRD JavaScript budget by avoiding client code
outside cart/variant/share interactions.

- [ ] **Step 4: Add dynamic social metadata and QR download**

Generate shop/product Open Graph images on demand and a downloadable QR code
whose content is the canonical HTTPS URL.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test src/lib/storefront
pnpm test:e2e tests/e2e/storefront.spec.ts
pnpm build
git add src tests
git commit -m "feat: add public storefront and sharing"
```

## Task 7: Fulfillment Configuration and Checkout Quote

**Files:**
- Create: `supabase/migrations/202606120005_fulfillment_checkout.sql`
- Create: `src/lib/fulfillment/schema.ts`
- Create: `src/lib/commerce/money.ts`
- Create: `src/lib/commerce/cart.ts`
- Create: `src/lib/commerce/quote.ts`
- Create: `src/app/api/checkout/quote/route.ts`
- Create: `src/app/(seller)/dashboard/settings/fulfillment/page.tsx`
- Create: `src/app/(seller)/dashboard/settings/fulfillment/actions.ts`
- Test: `src/lib/commerce/quote.test.ts`
- Test: `src/lib/fulfillment/schema.test.ts`

- [ ] **Step 1: Test quote calculation**

Cover single-seller enforcement, server price refresh, variant availability,
finite stock, preorder, delivery-zone eligibility, pickup, minor-unit totals,
currency consistency, and individually reported unavailable lines.

- [ ] **Step 2: Implement money and cart contracts**

```ts
export interface Money {
  amount: number;
  currency: "GHS" | "NGN";
}

export interface CheckoutQuote {
  sellerId: string;
  lines: QuoteLine[];
  subtotal: Money;
  discount: Money;
  fulfillmentFee: Money;
  total: Money;
  expiresAt: string;
  fingerprint: string;
}
```

Never calculate authoritative totals from browser-submitted prices.

- [ ] **Step 3: Implement seller-managed delivery and pickup**

Create delivery zones, fees, estimates, and pickup locations. Disable rather
than delete fulfillment options already referenced by orders.

- [ ] **Step 4: Implement quote endpoint**

Validate country-specific phone/address shapes only when needed, rate-limit by
IP/session, return typed field/line errors, and sign or persist a short-lived
quote fingerprint used during order creation.

- [ ] **Step 5: Verify and commit**

```bash
pnpm db:reset
pnpm db:test
pnpm test src/lib/commerce src/lib/fulfillment
git add src supabase
git commit -m "feat: add checkout quotes and fulfillment settings"
```

## Task 8: Idempotent Guest Order Creation and Inventory Reservation

**Files:**
- Create: `supabase/migrations/202606120006_orders.sql`
- Create: `src/lib/commerce/order.ts`
- Create: `src/lib/commerce/transitions.ts`
- Create: `src/app/api/checkout/orders/route.ts`
- Create: `src/components/storefront/cart-provider.tsx`
- Create: `src/components/storefront/checkout-form.tsx`
- Create: `src/app/(storefront)/[slug]/checkout/page.tsx`
- Create: `supabase/tests/database/004_order_functions.test.sql`
- Test: `src/lib/commerce/order.test.ts`
- Test: `tests/e2e/offline-checkout.spec.ts`

- [ ] **Step 1: Test order idempotency and snapshots**

Test duplicate submission keys, quote expiry, changed prices, last-item
contention, immutable line snapshots, non-sequential public references, secure
tracking tokens, and offline payment state.

- [ ] **Step 2: Create order schema and atomic database function**

Create `customers`, `customer_consents`, `orders`, `order_lines`,
`order_events`, and `idempotency_keys`. Implement one transaction that:

1. locks relevant variants,
2. validates quote fingerprint and current price,
3. reserves/decrements finite stock,
4. creates seller-scoped customer and consent records,
5. creates order and immutable lines,
6. writes the initial event,
7. returns the existing response for a repeated idempotency key.

- [ ] **Step 3: Implement guest checkout UI**

Use the country configuration for phone/address inputs, preserve valid data
after errors, show the complete total, and distinguish timeout/offline/server
rejection. Do not require buyer registration.

- [ ] **Step 4: Implement offline order path**

For enabled cash-on-delivery, pay-on-pickup, or seller-arranged payment, create
the order with `offline_due`, show explicit instructions, and proceed to the
same receipt/tracking flow.

- [ ] **Step 5: Verify and commit**

```bash
pnpm db:reset
pnpm db:test
pnpm test src/lib/commerce
pnpm test:e2e tests/e2e/offline-checkout.spec.ts
git add src supabase tests
git commit -m "feat: add idempotent guest checkout"
```

## Task 9: Paystack Payment Initialization, Webhooks, and Refunds

**Files:**
- Create: `supabase/migrations/202606120007_payments.sql`
- Create: `src/lib/payments/types.ts`
- Create: `src/lib/payments/paystack.ts`
- Create: `src/lib/payments/webhook.ts`
- Create: `src/app/api/payments/paystack/initialize/route.ts`
- Create: `src/app/api/payments/paystack/webhook/route.ts`
- Create: `src/app/api/payments/paystack/verify/route.ts`
- Create: `src/app/api/payments/paystack/refund/route.ts`
- Test: `src/lib/payments/paystack.test.ts`
- Test: `src/lib/payments/webhook.test.ts`
- Test: `tests/e2e/paystack-checkout.spec.ts`

- [ ] **Step 1: Test provider contracts**

Cover initialization amount/currency/subaccount, unique references, browser
redirect not confirming payment, HMAC signature verification, duplicate
events, delayed success, failed verification, full/partial refund, and
out-of-order event rejection.

- [ ] **Step 2: Create payment records**

Create `payment_attempts`, `provider_events`, `refunds`, and append-only
financial events. Add unique constraints on provider/reference and event ID.

- [ ] **Step 3: Implement Paystack adapter**

```ts
export interface PaymentProvider {
  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  verify(reference: string): Promise<VerifiedPayment>;
  refund(input: RefundPaymentInput): Promise<RefundResult>;
  verifyWebhook(rawBody: Uint8Array, signature: string): boolean;
}
```

Initialize on the server with current order total, email, reference,
subaccount/split configuration, and safe metadata.

- [ ] **Step 4: Implement webhook processing**

Read the raw body, verify `x-paystack-signature`, persist the provider event,
return 200 for an already processed event, and apply financial transitions in
one database transaction. Queue reconciliation for pending/ambiguous attempts
instead of polling in a loop.

- [ ] **Step 5: Implement refunds**

Authorize seller/operator actions, enforce refundable balance, initialize the
provider refund, and update state from provider evidence. Never mark refunded
only because the initiation request succeeded.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test src/lib/payments
pnpm test:e2e tests/e2e/paystack-checkout.spec.ts
pnpm typecheck
git add src supabase tests
git commit -m "feat: integrate Paystack payments"
```

## Task 10: Seller Commerce Cockpit and Order Workflow

**Files:**
- Create: `src/app/(seller)/dashboard/layout.tsx`
- Create: `src/app/(seller)/dashboard/page.tsx`
- Create: `src/app/(seller)/dashboard/orders/page.tsx`
- Create: `src/app/(seller)/dashboard/orders/[orderId]/page.tsx`
- Create: `src/app/(seller)/dashboard/orders/actions.ts`
- Create: `src/components/seller/mobile-nav.tsx`
- Create: `src/components/seller/metric-card.tsx`
- Create: `src/components/seller/order-actions.tsx`
- Create: `src/lib/commerce/dashboard.ts`
- Test: `src/lib/commerce/transitions.test.ts`
- Test: `tests/e2e/seller-fulfillment.spec.ts`

- [ ] **Step 1: Test deterministic transitions**

Test every allowed and rejected order/fulfillment/payment combination,
including cancelled paid orders requiring refund handling and completed offline
orders requiring an explicit recorded payment outcome.

- [ ] **Step 2: Implement the commerce cockpit**

Show new orders, exceptions, next actions, today's completed value/count,
visits, conversion, Add Product, and direct navigation to Home, Orders,
Products, Growth, and Shop. Query seller-scoped aggregates server-side.

- [ ] **Step 3: Implement order search and detail**

Filter by order/payment/fulfillment/date/buyer/reference/product. Show immutable
lines, buyer/fulfillment data, payment evidence, private notes, timeline, and
only actions allowed from the current state.

- [ ] **Step 4: Implement auditable mutations**

Every mutation records actor, source, previous/new states, timestamp, and
buyer-visible event when applicable. Reject stale concurrent actions using the
current event version.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test src/lib/commerce/transitions.test.ts
pnpm test:e2e tests/e2e/seller-fulfillment.spec.ts
pnpm build
git add src tests
git commit -m "feat: add seller commerce cockpit"
```

## Task 11: Secure Buyer Receipts, Tracking, and Notification Outbox

**Files:**
- Create: `supabase/migrations/202606120008_notifications.sql`
- Create: `src/app/orders/[token]/page.tsx`
- Create: `src/app/api/orders/[token]/route.ts`
- Create: `src/lib/notifications/types.ts`
- Create: `src/lib/notifications/outbox.ts`
- Create: `src/lib/notifications/email.ts`
- Create: `src/lib/notifications/whatsapp.ts`
- Create: `src/lib/notifications/templates.ts`
- Create: `src/app/api/internal/notifications/process/route.ts`
- Test: `src/lib/notifications/outbox.test.ts`
- Test: `tests/e2e/order-tracking.spec.ts`

- [ ] **Step 1: Test secure order access**

Test unguessable token lookup, expired/high-risk action verification,
buyer-safe event projection, no internal notes, and token rotation after a
security-sensitive change.

- [ ] **Step 2: Implement notification outbox**

Create `notifications`, `notification_attempts`, and seller in-app notification
records. Enqueue in the same transaction as order/payment transitions.
Processing must claim jobs safely, retry with backoff, and dead-letter after a
configured attempt limit without rolling back commerce state.

- [ ] **Step 3: Implement channels**

Email is required when available. WhatsApp sending is disabled unless the
buyer has valid consent and an approved template/provider configuration.
Always provide a buyer-initiated `wa.me` handoff when the seller has a valid
number.

- [ ] **Step 4: Implement receipt and tracking page**

Show public order reference, items, totals, payment state, simple fulfillment
state, seller contact/policies, timeline, and allowed support action.

- [ ] **Step 5: Verify and commit**

```bash
pnpm db:reset
pnpm db:test
pnpm test src/lib/notifications
pnpm test:e2e tests/e2e/order-tracking.spec.ts
git add src supabase tests
git commit -m "feat: add receipts and order notifications"
```

## Task 12: Analytics and Consent-Safe Metrics

**Files:**
- Create: `supabase/migrations/202606120009_analytics.sql`
- Create: `src/lib/analytics/events.ts`
- Create: `src/lib/analytics/record.ts`
- Create: `src/lib/analytics/metrics.ts`
- Create: `src/app/api/analytics/events/route.ts`
- Create: `src/app/(seller)/dashboard/growth/page.tsx`
- Test: `src/lib/analytics/metrics.test.ts`

- [ ] **Step 1: Test event and metric definitions**

Test visit, product view, checkout start, placed order, completed order,
payment success, fulfillment completion, bot/test exclusion, country/source
segmentation, and the exact completed-order definition from the PRD.

- [ ] **Step 2: Create privacy-minimized analytics records**

Store seller, anonymous session, event type, safe dimensions, campaign/source,
country, timestamp, and order/product references where necessary. Do not copy
phone, email, address, or payment payloads into analytics.

- [ ] **Step 3: Implement event ingestion and metrics**

Rate-limit public events, validate allowed dimensions, deduplicate event IDs,
and calculate metrics from authoritative order/payment/fulfillment records
when those records exist.

- [ ] **Step 4: Implement Growth dashboard baseline**

Show visits, product views, checkout starts, orders, completed orders, payment
success, fulfillment completion, date range, and visible metric definitions.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test src/lib/analytics
pnpm typecheck
git add src supabase
git commit -m "feat: add foundation commerce analytics"
```

## Task 13: Disputes, Risk Controls, and Admin Operations

**Files:**
- Create: `supabase/migrations/202606120010_support.sql`
- Create: `src/lib/support/transitions.ts`
- Create: `src/app/orders/[token]/support/page.tsx`
- Create: `src/app/(seller)/dashboard/orders/[orderId]/support/page.tsx`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/cases/page.tsx`
- Create: `src/app/admin/cases/[caseId]/page.tsx`
- Create: `src/app/admin/sellers/[sellerId]/page.tsx`
- Create: `src/app/api/admin/cases/[caseId]/route.ts`
- Test: `src/lib/support/transitions.test.ts`
- Test: `supabase/tests/database/005_operator_access.test.sql`
- Test: `tests/e2e/dispute.spec.ts`

- [ ] **Step 1: Test support-case transitions and permissions**

Cover buyer opening, seller response due, under review, resolution, closure,
evidence access, operator-only notes, seller restrictions, confirmation for
high-risk actions, and immutable audit history.

- [ ] **Step 2: Create support schema**

Create `support_cases`, `case_messages`, `case_evidence`, `risk_actions`,
`operators`, and `audit_events`. Store evidence in a private bucket with
short-lived signed access.

- [ ] **Step 3: Implement buyer and seller support flows**

Use structured reasons, descriptions, evidence, deadlines, seller response,
refund proposal, and buyer-visible outcome. Do not imply escrow or guaranteed
buyer protection.

- [ ] **Step 4: Implement admin operations**

Operators can review the full case context and apply warning, verification
requirement, payment restriction, temporary suspension, or permanent removal.
Require explicit confirmation and reason for destructive actions.

- [ ] **Step 5: Verify and commit**

```bash
pnpm db:reset
pnpm db:test
pnpm test src/lib/support
pnpm test:e2e tests/e2e/dispute.spec.ts
git add src supabase tests
git commit -m "feat: add disputes and admin operations"
```

## Task 14: PWA, Accessibility, Performance, and Failure Recovery

**Files:**
- Create: `src/app/manifest.ts`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `src/components/ui/offline-banner.tsx`
- Create: `src/lib/offline/drafts.ts`
- Create: `src/app/error.tsx`
- Create: `src/app/global-error.tsx`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/offline-recovery.spec.ts`
- Create: `lighthouserc.json`

- [ ] **Step 1: Add failing mobile quality tests**

Test manifest/installability, 44px controls, keyboard checkout, visible focus,
200% zoom layout, reduced motion, offline draft recovery, duplicate retry
protection, payment-pending messaging, and no sensitive order caching.

- [ ] **Step 2: Implement PWA metadata and safe caching**

Cache static assets and public shell resources only. Do not broadly cache
authenticated HTML, buyer tracking pages, customer records, or payment
responses.

- [ ] **Step 3: Implement drafts and recovery UI**

Store non-sensitive seller form drafts locally with schema version and expiry.
Show explicit offline/timed-out/rejected/server-failed states and preserve
valid form input.

- [ ] **Step 4: Enforce performance budgets**

Configure image sizes, fonts, bundle inspection, lazy loading, and Lighthouse
CI. The storefront target is primary content within 3 seconds on the agreed
good-3G profile and initial JS at or below 200 KB compressed excluding images
and provider payment UI.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test:e2e tests/e2e/accessibility.spec.ts \
  tests/e2e/offline-recovery.spec.ts
pnpm build
pnpm exec lhci autorun
git add src public tests lighthouserc.json
git commit -m "feat: harden mobile PWA experience"
```

## Task 15: Environments, Observability, Backup, and Launch Acceptance

**Files:**
- Create: `docs/runbooks/environments.md`
- Create: `docs/runbooks/payments.md`
- Create: `docs/runbooks/notifications.md`
- Create: `docs/runbooks/backup-restore.md`
- Create: `docs/runbooks/incidents.md`
- Create: `docs/requirements/foundation-traceability.md`
- Create: `tests/e2e/foundation-gh.spec.ts`
- Create: `tests/e2e/foundation-ng.spec.ts`
- Create: `.github/workflows/database.yml`
- Modify: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: Create P0 traceability**

Map every P0 ID in the PRD to its migration/module and automated or documented
acceptance test. The traceability check must fail CI when a P0 ID has no row.

- [ ] **Step 2: Configure development, preview, staging, and production**

Document separate Supabase/Paystack/email/WhatsApp configuration, secret
ownership, migration order, preview limitations, and production promotion.
Use Paystack test mode outside production and never share provider references
between environments.

- [ ] **Step 3: Add observability**

Record structured request IDs, order/payment references, provider event IDs,
job attempts, and redacted errors. Alert on payment webhook failure, growing
pending payments, notification dead letters, migration failure, elevated
checkout errors, and cross-tenant authorization denials.

- [ ] **Step 4: Verify backup restoration and incident runbooks**

Restore a staging backup into an isolated local/staging environment, verify
core row counts and order/payment relationships, and record the date/result.
Document payment reconciliation and provider outage procedures.

- [ ] **Step 5: Run Foundation acceptance**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:reset
pnpm db:test
pnpm test:e2e
pnpm build
pnpm exec lhci autorun
```

Expected: all commands exit 0 and both GH/NG Paystack test-mode journeys pass.

- [ ] **Step 6: Commit the release candidate**

```bash
git add README.md docs tests .github
git commit -m "docs: add foundation launch runbooks"
```

## Final PRD Coverage Review

Before declaring Foundation complete:

- Confirm all 88 P0 requirement IDs appear in
  `docs/requirements/foundation-traceability.md`.
- Confirm the seven PRD end-to-end scenarios and all listed failure scenarios
  have passing tests or signed documented evidence.
- Confirm Growth and Scale behavior remains disabled or absent rather than
  partially exposed.
- Confirm Paystack implementation matches current official webhook,
  verification, split/subaccount, refund, and rate-limit guidance.
- Confirm the existing MVP design is treated as superseded where the PRD says
  so.

### P0 Requirement-to-Task Map

| PRD requirements | Primary implementation tasks |
|---|---|
| ACC-001 through ACC-009 | Tasks 2, 3, 4 |
| SHP-001 through SHP-006 | Tasks 4, 5, 6 |
| CAT-001 through CAT-009 | Tasks 5, 8 |
| SOC-001 through SOC-004 | Task 6 |
| CHK-001 through CHK-009 | Tasks 7, 8 |
| PAY-001 through PAY-012 | Tasks 4, 8, 9 |
| FUL-001 through FUL-007 | Tasks 7, 10 |
| ORD-001 through ORD-007 | Tasks 8, 10 |
| NOT-001 through NOT-008 | Task 11 |
| CUS-001 through CUS-004 | Tasks 8, 11, 12 |
| GRO-001 through GRO-003 | Task 12 |
| BIL-001 through BIL-002 | Tasks 2, 4, 15 |
| OPS-001 through OPS-008 | Tasks 9, 13, 15 |
| Mobile, PWA, accessibility, performance | Tasks 1, 6, 14 |
| Security, privacy, reliability, backups | Tasks 2, 3, 9, 11, 13, 15 |
| Metrics and 90-day launch measurement | Tasks 10, 12, 15 |
