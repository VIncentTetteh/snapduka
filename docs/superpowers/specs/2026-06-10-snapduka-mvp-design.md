# SnapDuka MVP — Design

**Status:** Approved (pending user review of this document)
**Date:** 2026-06-10
**Author:** Vincent Tetteh, with Claude
**Source:** Project Spec v0.1 (Phase 1 MVP)

## Summary

SnapDuka gives social-media sellers in Ghana a mobile-first storefront page and
order capture system. This document records the technical design decisions for
the Phase 1 MVP, refined from the v0.1 spec. Scope is unchanged from the spec:
seller onboarding, public storefront per seller, product management, public
order form, and a seller dashboard. Payments, chatbots, and analytics remain
out of scope.

## Decisions Made (vs. open items in the v0.1 spec)

| Open item in spec | Decision | Rationale |
|---|---|---|
| Seller auth: phone+OTP or email/password | **Email + password** (Supabase Auth) | Zero per-login cost; first cohort is hand-onboarded so account setup is assisted. Phone OTP deferred to Phase 2 when revenue can cover SMS costs and delivery reliability can be tested. |
| New-order notification | **Buyer-driven WhatsApp ping** | After submitting, the buyer sees a "Send your order to the seller on WhatsApp" button opening `wa.me/<seller>` with a pre-filled order summary. Zero cost, no API integration, notifies sellers on an app they already use. The database remains the system of record; the dashboard remains the canonical order list. |
| Admin tooling | **None in MVP** | Admin (Vincent) uses a seed script + Supabase Studio to onboard the 10–15 seller cohort. An admin UI is not justified at this scale. |
| Architecture style | **RLS-first** (Option A) | Authorization enforced in Postgres via Row-Level Security rather than re-implemented per API route. Less code, can't be bypassed by a buggy route, right fit for a solo maintainer. |

## Architecture

- **Framework:** Next.js (App Router), TypeScript strict mode, Tailwind CSS.
- **Backend services:** Supabase — Postgres, Auth (email/password), Storage
  (product images, public bucket).
- **Hosting:** Vercel, auto-deploy from `main`. Free tiers throughout.
- **No other infrastructure.** The enterprise platform standards in the global
  CLAUDE.md (EKS/Terraform/Istio etc.) explicitly do not apply to this
  project's infrastructure; their spirit applies to code quality, testing, and
  security.

### Routes

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Minimal landing page |
| `/[slug]` | Public | Seller storefront. Server-rendered with incremental revalidation — fast and cheap on 3G/low-end Android. |
| `/api/orders` | Public POST | Order submission endpoint |
| `/login` | Public | Seller login |
| `/dashboard` | Authenticated seller | Product CRUD, orders list + status updates, basic counts (total products, total orders, new today) |

## Data Model

The spec's schema with four corrections:

```sql
-- sellers: + auth_user_id, slug constraint
sellers (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique references auth.users(id),
  business_name   text not null,
  owner_name      text,
  phone           text not null,
  whatsapp_number text,
  snapchat_handle text,
  slug            text unique not null check (slug ~ '^[a-z0-9](-?[a-z0-9])*$'),
  location        text,
  created_at      timestamptz default now()
)

-- products: price required + non-negative, status constrained
products (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references sellers(id) on delete cascade,
  name        text not null,
  description text,
  price       numeric(10,2) not null check (price >= 0),
  currency    text not null default 'GHS',
  image_url   text,
  category    text,
  status      text not null default 'available'
              check (status in ('available','sold_out','hidden')),
  created_at  timestamptz default now()
)

-- orders: snapshot fields + on delete set null + constraints
orders (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references sellers(id),
  product_id     uuid references products(id) on delete set null,
  product_name   text not null,           -- snapshot at order time
  unit_price     numeric(10,2) not null,  -- snapshot at order time
  customer_name  text,
  customer_phone text not null,
  quantity       int not null default 1 check (quantity between 1 and 100),
  notes          text,
  status         text not null default 'new'
                 check (status in ('new','contacted','confirmed','fulfilled','cancelled')),
  created_at     timestamptz default now()
)
```

**Why the changes:**
1. `auth_user_id` links a Supabase login to a seller row — required for RLS.
2. Order snapshots (`product_name`, `unit_price`) + `on delete set null`:
   products get edited and deleted; order history must record what was bought
   and at what price. The spec's plain FK would either block product deletion
   or lose this information.
3. `CHECK` constraints on status, slug, price, quantity — bad data is more
   expensive than constraints.
4. Indexes: `sellers(slug)`, `products(seller_id, status)`,
   `orders(seller_id, status, created_at)` — matching the app's three hot
   queries.

Migrations live in `supabase/migrations/` from day one. Schema is never
hand-edited in Studio.

## Security Model (RLS)

| Table | Public (anon) | Seller (authenticated) |
|---|---|---|
| `sellers` | `SELECT` (storefront header needs it) | `UPDATE` own row (`auth_user_id = auth.uid()`) |
| `products` | `SELECT` where `status != 'hidden'` | Full CRUD on own rows |
| `orders` | No read. `INSERT` only via `/api/orders` | `SELECT`/`UPDATE` own rows; status restricted to allowed values |

- `/api/orders` validates with Zod (Ghana phone normalized to `+233…` format),
  includes a honeypot field, and applies a lightweight per-IP throttle to
  deter junk submissions.
- The service-role key is never used in any client-reachable code path.
- Secrets live in Vercel/Supabase env vars only. `.env.example` documents
  variable names, never values.
- **Flagged, accepted risk:** buyer phone numbers are PII stored in plain
  Postgres. Acceptable at MVP scale; revisit before any analytics or export
  feature (Phase 4) and before onboarding beyond the pilot cohort.

## Buyer Order Flow

1. Buyer opens `/[slug]` from the seller's Snapchat/WhatsApp/Instagram bio.
2. Taps "Order" on a product → bottom-sheet form: name, phone, quantity,
   optional note.
3. Form POSTs to `/api/orders`; explicit submitting → success/error states.
4. Success screen: "Seller will contact you shortly" + prominent **"Send your
   order to the seller on WhatsApp"** button (`wa.me` deep link, pre-filled
   order summary).
5. Error state preserves form input, offers retry and a direct "call seller"
   fallback link. Order submission never fails silently.

Sold-out products render in the grid but their Order button is disabled.

## Images

- Client-side resize before upload (canvas, max ~1000px longest edge, WebP) —
  protects sellers' data bundles on upload and buyers' on download.
- Stored in a public Supabase Storage bucket, namespaced per seller
  (`<seller_id>/<uuid>.webp`).
- Upload failure keeps the product form state intact.

## Error Handling Principles

- All user-facing mutations have explicit loading/success/error states.
- API routes return typed error responses; no swallowed exceptions.
- Storefront renders a friendly not-found page for unknown slugs.

## Testing

Pragmatic scope for a solo MVP (deliberately narrower than the global 80%
blanket threshold):

- **Unit (Vitest):** Zod schemas, phone normalization, slug generation,
  WhatsApp link builder, price formatting.
- **Integration:** `/api/orders` route (validation, honeypot, insert path).
- **RLS:** SQL tests against local Supabase verifying each policy in the
  table above (especially: seller A cannot read/write seller B's data; anon
  cannot read orders).
- **E2E (stretch, Week 4):** Playwright — buyer browse → order → confirmation.

## Repo & Delivery

- `git init` on `main`; GitHub remote; Vercel auto-deploys `main`. Solo
  project: trunk-based, no staging environment in MVP.
- `supabase/migrations/` for schema; seed script for onboarding cohort
  sellers.
- Follows spec timeline: Week 1 = repo, schema, scaffold, deployed skeleton.

## Out of Scope (unchanged from spec)

MoMo payments, WhatsApp Cloud API auto-replies, CRM/analytics, multi-user
seller accounts, native app, buyer accounts, cart/multi-product orders
(one product per order in MVP).
