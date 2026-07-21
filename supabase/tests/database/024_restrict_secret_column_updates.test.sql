-- supabase/tests/database/024_restrict_secret_column_updates.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000024101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','secret-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000024201','00000000-0000-0000-0000-000000024101','GH','active',true,'Secret Fixture Seller','secret-fixture@example.com','+233241234585');

insert into public.outbound_webhooks (id, seller_account_id, url, secret_encrypted, event_types)
values ('00000000-0000-0000-0000-000000024301','00000000-0000-0000-0000-000000024201','https://example.com/hook','original-secret','{}');

insert into public.courier_connections (id, seller_account_id, provider, credentials_encrypted)
values ('00000000-0000-0000-0000-000000024401','00000000-0000-0000-0000-000000024201','fixture-provider','original-creds');

select throws_ok(
  $$ set local role authenticated; update public.outbound_webhooks set secret_encrypted = 'attacker-secret' where id = '00000000-0000-0000-0000-000000024301' $$,
  '42501',
  null,
  'authenticated cannot update outbound_webhooks.secret_encrypted'
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

select * from finish();
rollback;
