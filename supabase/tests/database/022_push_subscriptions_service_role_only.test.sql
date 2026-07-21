-- supabase/tests/database/022_push_subscriptions_service_role_only.test.sql
begin;

set local search_path = extensions, public;

select plan(2);

-- Fixture: a real seller_account so the service_role insert below satisfies
-- push_subscriptions_seller_account_id_fkey (the throws_ok case never
-- reaches the FK check — the grant revocation rejects it first).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000022101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','push-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000022201','00000000-0000-0000-0000-000000022101','GH','active',true,'Push Fixture Seller','push-fixture@example.com','+233241234583');

select throws_ok(
  $$ set local role authenticated;
     insert into public.push_subscriptions (seller_account_id, endpoint, p256dh, auth)
     values (gen_random_uuid(), 'https://example.com/push/attacker', 'x', 'y') $$,
  '42501',
  null,
  'authenticated cannot insert push_subscriptions directly'
);

select lives_ok(
  $$ insert into public.push_subscriptions (seller_account_id, endpoint, p256dh, auth)
     values ('00000000-0000-0000-0000-000000022201', 'https://example.com/push/service-role-write', 'x', 'y') $$,
  'service_role (the default test role) can still insert push_subscriptions'
);

select * from finish();
rollback;
