-- supabase/tests/database/013_billing_plan_changes.test.sql
begin;

set local search_path = extensions, public;

select plan(9);

select has_column('public', 'seller_subscriptions', 'pending_plan_id', 'has pending_plan_id');
select has_column('public', 'seller_subscriptions', 'pending_plan_version', 'has pending_plan_version');
select has_column('public', 'seller_subscriptions', 'pending_price_id', 'has pending_price_id');
select has_column('public', 'seller_subscriptions', 'pending_change_type', 'has pending_change_type');
select has_column('public', 'seller_subscriptions', 'provider_authorization_code', 'has provider_authorization_code');

select is(
  has_table_privilege('authenticated', 'public.seller_subscriptions', 'INSERT'),
  false,
  'sellers cannot insert their own subscription row directly'
);
select is(
  has_table_privilege('authenticated', 'public.seller_subscriptions', 'UPDATE'),
  false,
  'sellers cannot update their own subscription row directly'
);

-- Fixture: a seller with an active Growth subscription, to exercise the
-- pending-shape constraint.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000007101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'billing-fixture@example.com', '',
  now(), '{}'::jsonb, now(), now()
);
insert into public.seller_accounts (
  id, auth_user_id, country, status, is_active,
  contact_name, contact_email, contact_phone
)
values (
  '00000000-0000-0000-0000-000000007201',
  '00000000-0000-0000-0000-000000007101',
  'GH', 'active', true, 'Billing Fixture Seller',
  'billing-fixture@example.com', '+233241234574'
);
insert into public.seller_subscriptions (
  id, seller_account_id, plan_id, plan_version, state,
  current_period_start, current_period_end
)
select
  '00000000-0000-0000-0000-000000007301',
  '00000000-0000-0000-0000-000000007201',
  id, version, 'active', now(), now() + interval '30 days'
from public.plans where code = 'growth' and active;

-- A downgrade must carry all three pending fields together.
select throws_ok(
  $$
    update public.seller_subscriptions
    set pending_change_type = 'downgrade'
    where id = '00000000-0000-0000-0000-000000007301'
  $$,
  '23514',
  null,
  'a downgrade without pending_plan_id/version/price_id is rejected'
);

-- A cancel must NOT carry a pending plan.
select throws_ok(
  $$
    update public.seller_subscriptions
    set pending_change_type = 'cancel',
        pending_plan_id = (select id from public.plans where code = 'scale' and active)
    where id = '00000000-0000-0000-0000-000000007301'
  $$,
  '23514',
  null,
  'a cancel with a pending_plan_id is rejected'
);

select * from finish();
rollback;
