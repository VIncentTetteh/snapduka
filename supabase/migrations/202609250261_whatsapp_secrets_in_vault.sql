-- WhatsApp Cloud API credentials in Vault.
--
-- WHATSAPP_APP_SECRET is the HMAC key that decides whether a POST to the public
-- /api/whatsapp/webhook is really from Meta. Whoever holds it can inject
-- "buyer" messages into any seller's inbox and spend their AI budget.
-- WHATSAPP_ACCESS_TOKEN sends as the business. Both lived only in Vercel env,
-- where they are readable by anyone with project access, copied into every
-- preview deployment, and rotated by a redeploy.
--
-- Vault is already where this platform keeps the secrets that matter:
-- 202607310051 (app_base_url, internal_job_secret, read by run_internal_job)
-- and 202609050088 (outbound webhook signing secrets). This follows the same
-- shape: the secrets are seeded out-of-band with vault.create_secret() — never
-- in a migration, which is committed to git — and read back through one
-- SECURITY DEFINER function that only service_role may execute.
--
-- Seed (once per environment, from a psql session, not from a file):
--   select vault.create_secret('<app secret>',   'whatsapp_app_secret',   'Meta app secret for X-Hub-Signature-256');
--   select vault.create_secret('<access token>', 'whatsapp_access_token', 'WhatsApp Cloud API system-user token');
--   select vault.create_secret('<verify token>', 'whatsapp_verify_token', 'WhatsApp webhook subscription verify token');
-- Rotate with vault.update_secret(id, '<new value>'); the app picks the new
-- value up within its in-process cache TTL (src/lib/whatsapp/vault.ts).
--
-- Any secret not in Vault falls back to the env var of the same name in the
-- app, so local development and a partially seeded environment keep working.

create or replace function public.whatsapp_platform_secrets()
returns table (app_secret text, access_token text, verify_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'whatsapp_app_secret'),
    (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'whatsapp_access_token'),
    (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'whatsapp_verify_token');
$$;

comment on function public.whatsapp_platform_secrets() is
  'WhatsApp Cloud API secrets from Vault (null where not seeded; the app falls back to env). service_role only: these secrets must never reach a browser session.';

revoke all on function public.whatsapp_platform_secrets() from public, anon, authenticated;
grant execute on function public.whatsapp_platform_secrets() to service_role;
