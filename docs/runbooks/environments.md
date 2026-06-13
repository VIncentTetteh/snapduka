# Environments

Use separate Supabase projects, Paystack integrations, notification credentials, domains, and secrets for development, preview, staging, and production.

| Environment | Payments | Data | Purpose |
| --- | --- | --- | --- |
| Development | Paystack test mode or mocks | Local Supabase | Feature work |
| Preview | Paystack test mode | Disposable preview project | Pull-request review |
| Staging | Paystack test mode | Persistent non-production project | Release acceptance |
| Production | Paystack live mode | Production project | Real commerce |

Required secrets are listed in `.env.example`. Secret keys are server-only. Never expose `SUPABASE_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, notification credentials, or internal job credentials through `NEXT_PUBLIC_*`.

Promote migrations in filename order. Run database tests against a restored staging copy before production promotion. Provider references must never be reused across environments.
