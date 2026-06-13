# SnapDuka

SnapDuka is a mobile-first social-commerce operating system for physical-product sellers in Ghana and Nigeria. Sellers publish a storefront, share product links through social channels, receive guest orders, accept Paystack or offline payment, fulfill orders, notify buyers, and mediate support cases.

## Local Development

Requirements: Node.js 22, pnpm 10, Docker, and the Supabase CLI.

```bash
cp .env.example .env.local
pnpm install
pnpm supabase:start
pnpm db:reset
pnpm dev
```

Use the values from `pnpm exec supabase status -o env` for local Supabase variables. Paystack test keys must be used outside production.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:reset
pnpm db:test
pnpm test:e2e
pnpm build
pnpm traceability
```

## Architecture

- Next.js App Router and React for seller, buyer, and operator interfaces.
- Supabase/PostgreSQL with forced row-level security.
- Atomic guest-order creation and stock reservation in PostgreSQL.
- Paystack initialization on the server and signed, idempotent webhook processing.
- Independent payment, order, fulfillment, refund, dispute, and notification states.
- Public guest storefronts and secure unguessable order-tracking URLs.

Production configuration and incident procedures are documented in [`docs/runbooks`](docs/runbooks).
The hosting checklist is in [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md).
