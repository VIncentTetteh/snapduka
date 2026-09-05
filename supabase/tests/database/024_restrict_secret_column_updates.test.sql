-- supabase/tests/database/024_restrict_secret_column_updates.test.sql
begin;

set local search_path = extensions, public;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000024101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','secret-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000024201','00000000-0000-0000-0000-000000024101','GH','active',true,'Secret Fixture Seller','secret-fixture@example.com','+233241234585');

-- outbound_webhooks.secret_encrypted was dropped in 202609050088: the signing
-- secret lives in Vault now, so there is no secret column left on this row to
-- protect. What remains to assert is that the row is still writable only in the
-- narrow way 202607210043 intended, and that secret_id is not one of the
-- columns the seller may set.
insert into public.outbound_webhooks (id, seller_account_id, url, event_types)
values ('00000000-0000-0000-0000-000000024301','00000000-0000-0000-0000-000000024201','https://example.com/hook','{}');

insert into public.courier_connections (id, seller_account_id, provider, credentials_encrypted)
values ('00000000-0000-0000-0000-000000024401','00000000-0000-0000-0000-000000024201','fixture-provider','original-creds');

select throws_ok(
  $$ set local role authenticated; update public.outbound_webhooks set secret_id = gen_random_uuid() where id = '00000000-0000-0000-0000-000000024301' $$,
  '42501',
  null,
  'authenticated cannot repoint outbound_webhooks.secret_id at another vault secret'
);
select lives_ok(
  $$ set local role authenticated; update public.outbound_webhooks set active = false where id = '00000000-0000-0000-0000-000000024301' $$,
  'authenticated can still update outbound_webhooks.active'
);
select throws_ok(
  $$ set local role authenticated; update public.courier_connections set credentials_encrypted = 'attacker-creds' where id = '00000000-0000-0000-0000-000000024401' $$,
  '42501',
  null,
  'authenticated cannot update courier_connections.credentials_encrypted'
);
select lives_ok(
  $$ set local role authenticated; update public.courier_connections set active = false where id = '00000000-0000-0000-0000-000000024401' $$,
  'authenticated can still update courier_connections.active'
);

-- Every webhook now has to come from create_outbound_webhook, which is what
-- puts the signing secret into Vault. A direct insert could not do that, so the
-- webhook it created would be permanently unsignable.
select throws_ok(
  $$ set local role authenticated; insert into public.outbound_webhooks (seller_account_id, url, event_types) values ('00000000-0000-0000-0000-000000024201','https://example.com/second','{}') $$,
  '42501',
  null,
  'authenticated cannot insert a webhook directly, bypassing the secret'
);

-- And the secret is readable only by the dispatcher. `authenticated` holding
-- EXECUTE here would put every seller's signing key one PostgREST call away,
-- which is the exposure this whole change removes.
select ok(
  not has_function_privilege('authenticated', 'public.webhook_signing_secret(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.webhook_signing_secret(uuid)', 'EXECUTE'),
  'only service_role may read a webhook signing secret'
);

select * from finish();
rollback;
