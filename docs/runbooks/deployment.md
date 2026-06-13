# Deployment

The Foundation release is designed for Vercel with a linked hosted Supabase
project. Use Paystack test mode until staging acceptance is complete.

## Vercel

Authenticate and deploy from the repository root:

```bash
pnpm dlx vercel login
pnpm dlx vercel link
pnpm dlx vercel deploy
```

Configure these values for Preview and Production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `PAYSTACK_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL`
- `EMAIL_WEBHOOK_URL`
- `INTERNAL_JOB_SECRET`

After the preview URL is known, set `NEXT_PUBLIC_APP_URL` to that origin and
redeploy. Keep all variables except the two explicitly prefixed
`NEXT_PUBLIC_` server-only.

## Provider Configuration

In Supabase Auth, set the site URL to the deployed origin and allow
`https://<origin>/auth/confirm` as a redirect URL.

In Paystack test mode, register:

```text
https://<origin>/api/payments/paystack/webhook
```

The notification processor must be called periodically with:

```text
POST /api/internal/notifications/process
Authorization: Bearer $INTERNAL_JOB_SECRET
```

Use a scheduler that can send authenticated POST requests. Do not expose the
job secret in a URL.

## Acceptance

1. Create a seller and finish onboarding.
2. Publish a product and open its public storefront.
3. Complete one offline order and one Paystack test order.
4. Confirm webhook idempotency, receipt access, fulfillment updates, and
   notification delivery.
5. Run Lighthouse against the deployed storefront and verify mobile checkout
   on a throttled connection.

Rotate any credential that has been shared through chat or logs before enabling
live payments.
