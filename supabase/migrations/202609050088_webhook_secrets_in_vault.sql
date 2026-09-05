-- Put webhook signing secrets in Vault, where the column name already claimed
-- they were.
--
-- `outbound_webhooks.secret_encrypted` is a plain `text` column holding the
-- seller's signing secret verbatim. Nothing encrypts it on the way in and
-- nothing decrypts it on the way out — `signWebhook(body, hook.secret_encrypted)`
-- uses the column value directly as the HMAC key. The name asserts a property
-- the code does not have, which is worse than an honestly-named plaintext
-- column: it stops anyone reading this schema from noticing.
--
-- Two consequences. Any read of the table — a dump, a backup, a support query,
-- a future RLS mistake — yields every seller's signing secret, and a signing
-- secret is exactly the value that lets someone forge events the seller's own
-- systems will trust. And 202607210043 went to the trouble of revoking UPDATE
-- on this column while leaving SELECT wide open to the row owner, so the
-- protection that exists guards the wrong direction.
--
-- Vault is already the mechanism here: 202607310051 stores app_base_url and
-- internal_job_secret there, and run_internal_job reads them through
-- vault.decrypted_secrets from a SECURITY DEFINER function. This follows that
-- precedent exactly.
--
-- There are zero webhook rows in production, so no secret is exposed today and
-- nothing needs migrating. That is why the plaintext column can simply go
-- rather than being backfilled and deprecated.

alter table public.outbound_webhooks add column secret_id uuid;

comment on column public.outbound_webhooks.secret_id is
  'vault.secrets id for this webhook''s signing secret. The secret itself is never stored here.';

-- ── Creating a webhook, secret and all, in one statement ────────────────────
-- A single function rather than "insert, then attach a secret": the two-step
-- version can leave a webhook with no secret if the second call fails, and a
-- webhook that cannot be signed is worse than no webhook.
--
-- SECURITY DEFINER because only the definer may write to vault. It derives the
-- seller itself and never takes one as a parameter, so it cannot be pointed at
-- another account.
create or replace function public.create_outbound_webhook(
  p_url text,
  p_event_types text[],
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid;
  v_webhook_id uuid;
  v_secret_id uuid;
begin
  v_seller := public.current_seller_account_id();
  -- NULL for a team member, which is the intended answer: webhooks are
  -- owner-only, and the app enforces the same rule.
  if v_seller is null then
    raise exception using errcode = '42501', message = 'Only the account owner can add a webhook.';
  end if;

  if coalesce(btrim(p_secret), '') = '' then
    raise exception using errcode = '22023', message = 'A signing secret is required.';
  end if;
  if p_event_types is null or array_length(p_event_types, 1) is null then
    raise exception using errcode = '22023', message = 'Choose at least one event to send.';
  end if;

  insert into public.outbound_webhooks (seller_account_id, url, event_types)
  values (v_seller, p_url, p_event_types)
  returning id into v_webhook_id;

  -- Named by webhook id so the secret is traceable back to its row, and so a
  -- second webhook cannot collide with the first.
  v_secret_id := vault.create_secret(
    p_secret,
    'webhook_signing_secret:' || v_webhook_id::text,
    'Outbound webhook signing secret'
  );

  update public.outbound_webhooks set secret_id = v_secret_id where id = v_webhook_id;

  return v_webhook_id;
end;
$$;

-- ── Reading it back, for the dispatcher only ────────────────────────────────
-- service_role only. `authenticated` is deliberately absent: the seller chose
-- this secret and holds their own copy, and giving the browser a way to read it
-- back would reintroduce exactly the exposure this migration removes.
create or replace function public.webhook_signing_secret(p_webhook_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select secret_id into v_secret_id
  from public.outbound_webhooks where id = p_webhook_id;
  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where id = v_secret_id;

  return v_secret;
end;
$$;

-- ── The plaintext column goes ───────────────────────────────────────────────
-- Nothing reads it after this migration, and there are no rows to preserve.
alter table public.outbound_webhooks drop column secret_encrypted;

-- 202607210043 re-granted UPDATE on the non-secret columns after revoking it
-- table-wide. secret_id must not join that list: rotating a secret goes through
-- the function, not through PostgREST.
revoke update on public.outbound_webhooks from authenticated;
grant update (url, event_types, active) on public.outbound_webhooks to authenticated;

-- Every insert now goes through create_outbound_webhook, which guarantees a
-- secret exists. A direct insert could not create one, so a webhook minted that
-- way would be permanently unsignable.
revoke insert on public.outbound_webhooks from authenticated;

revoke execute on function public.create_outbound_webhook(text, text[], text) from public, anon;
grant execute on function public.create_outbound_webhook(text, text[], text) to authenticated, service_role;

revoke execute on function public.webhook_signing_secret(uuid) from public, anon, authenticated;
grant execute on function public.webhook_signing_secret(uuid) to service_role;
