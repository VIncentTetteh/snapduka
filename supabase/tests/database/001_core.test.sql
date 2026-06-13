begin;

set local search_path = extensions, public;

select plan(69);

select has_extension('pgcrypto', 'pgcrypto extension is enabled');
select has_extension('pgtap', 'pgtap extension is enabled');

select has_type('public', 'country_code', 'country code enum exists');
select has_type('public', 'currency_code', 'currency code enum exists');
select has_type('public', 'verification_state', 'verification enum exists');
select has_type(
  'public',
  'seller_account_status',
  'seller account status enum exists'
);
select has_type('public', 'shop_status', 'shop enum exists');
select has_type('public', 'product_status', 'product enum exists');
select has_type('public', 'inventory_policy', 'inventory policy enum exists');
select has_type('public', 'order_status', 'order enum exists');
select has_type('public', 'payment_status', 'payment enum exists');
select has_type('public', 'fulfillment_status', 'fulfillment enum exists');
select has_type('public', 'refund_status', 'refund enum exists');
select has_type('public', 'dispute_status', 'dispute enum exists');
select has_type('public', 'consent_status', 'consent enum exists');
select has_type('public', 'notification_status', 'notification enum exists');
select has_type('public', 'actor_type', 'actor type enum exists');
select has_type(
  'public',
  'payment_subaccount_status',
  'payment subaccount status enum exists'
);

select enum_has_labels(
  'public',
  'verification_state',
  array[
    'not_started',
    'in_progress',
    'needs_action',
    'verified',
    'rejected',
    'suspended'
  ],
  'verification states are stable'
);

select enum_has_labels(
  'public',
  'payment_status',
  array[
    'unpaid',
    'pending',
    'paid',
    'failed',
    'partially_refunded',
    'refunded',
    'offline_due'
  ],
  'payment states are stable'
);

select enum_has_labels(
  'public',
  'fulfillment_status',
  array[
    'unconfirmed',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'dispatched',
    'fulfilled',
    'cancelled',
    'returned'
  ],
  'fulfillment states are stable'
);

select enum_has_labels(
  'public',
  'refund_status',
  array['none', 'requested', 'processing', 'partial', 'completed', 'failed'],
  'refund states are stable'
);

select enum_has_labels(
  'public',
  'dispute_status',
  array[
    'none',
    'opened',
    'seller_response_due',
    'under_review',
    'resolved',
    'closed'
  ],
  'dispute states are stable'
);

select has_table('public', 'country_configs', 'country configs table exists');
select has_table('public', 'plans', 'plans table exists');
select has_table('public', 'seller_accounts', 'seller accounts table exists');
select has_table('public', 'shops', 'shops table exists');
select has_table(
  'public',
  'seller_verifications',
  'seller verifications table exists'
);
select has_table(
  'public',
  'payment_subaccounts',
  'payment subaccounts table exists'
);
select has_table(
  'public',
  'seller_entitlements',
  'seller entitlements table exists'
);
select has_table('public', 'audit_events', 'audit events table exists');

select results_eq(
  $$
    select country::text, currency::text, calling_code
    from public.country_configs
    order by country
  $$,
  $$
    values
      ('CI'::text, 'XOF'::text, '+225'::text),
      ('GH'::text, 'GHS'::text, '+233'::text),
      ('NG'::text, 'NGN'::text, '+234'::text)
  $$,
  'supported country configurations are seeded'
);

select is(
  (
    select version
    from public.plans
    where code = 'free' and active
  ),
  1,
  'active free plan is version 1'
);

select is(
  (
    select entitlements ->> 'shops'
    from public.plans
    where code = 'free' and version = 1
  ),
  '1',
  'free plan includes the one-shop entitlement baseline'
);

select throws_ok(
  $$
    update public.plans
    set id = gen_random_uuid()
    where code = 'free' and version = 1
  $$,
  '55000',
  'plan version payload is immutable',
  'plan ID is immutable'
);

select throws_ok(
  $$
    update public.plans
    set code = 'starter'
    where code = 'free' and version = 1
  $$,
  '55000',
  'plan version payload is immutable',
  'plan code is immutable'
);

select throws_ok(
  $$
    update public.plans
    set name = 'Starter'
    where code = 'free' and version = 1
  $$,
  '55000',
  'plan version payload is immutable',
  'plan name is immutable'
);

select throws_ok(
  $$
    update public.plans
    set version = 2
    where code = 'free' and version = 1
  $$,
  '55000',
  'plan version payload is immutable',
  'plan version number is immutable'
);

select throws_ok(
  $$
    update public.plans
    set entitlements = '{"shops":2}'::jsonb
    where code = 'free' and version = 1
  $$,
  '55000',
  'plan version payload is immutable',
  'plan entitlement payload is immutable'
);

select throws_ok(
  $$
    insert into public.plans (
      code,
      name,
      version,
      entitlements,
      active
    )
    values (
      'invalid_entitlements',
      'Invalid Entitlements',
      1,
      '[]'::jsonb,
      false
    )
  $$,
  '23514',
  'new row for relation "plans" violates check constraint "plans_entitlements_check"',
  'plan entitlements must be a JSON object'
);

select throws_ok(
  $$
    update public.country_configs
    set address_fields = array['line1', 'area', 'city', 'city']
    where country = 'GH'
  $$,
  '23514',
  'new row for relation "country_configs" violates check constraint "country_configs_address_fields_check"',
  'country address fields reject duplicates'
);

select throws_ok(
  $$
    update public.country_configs
    set address_fields = array['line1', 'city', 'area', 'region']
    where country = 'GH'
  $$,
  '23514',
  'new row for relation "country_configs" violates check constraint "country_configs_address_fields_check"',
  'country address fields enforce canonical order'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'seller-one@example.com',
    '',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'seller-two@example.com',
    '',
    now(),
    now(),
    now()
  );

insert into public.seller_accounts (
  id,
  auth_user_id,
  country,
  status,
  is_active,
  contact_name,
  contact_email,
  contact_phone
)
values
  (
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000101',
    'GH',
    'active',
    true,
    'Seller One',
    'seller-one@example.com',
    '+233200000001'
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000102',
    'NG',
    'active',
    true,
    'Seller Two',
    'seller-two@example.com',
    '+2348000000002'
  );

select throws_ok(
  $$
    update public.seller_accounts
    set status = 'pending'
    where id = '00000000-0000-0000-0000-000000000201'
  $$,
  '23514',
  'new row for relation "seller_accounts" violates check constraint "seller_accounts_active_status_check"',
  'non-active seller status requires is_active false'
);

select throws_ok(
  $$
    update public.seller_accounts
    set is_active = false
    where id = '00000000-0000-0000-0000-000000000201'
  $$,
  '23514',
  'new row for relation "seller_accounts" violates check constraint "seller_accounts_active_status_check"',
  'active seller status requires is_active true'
);

select lives_ok(
  $$
    insert into public.seller_verifications (
      seller_account_id,
      state
    )
    values (
      '00000000-0000-0000-0000-000000000201',
      'not_started'
    )
  $$,
  'not-started verification permits empty provider fields'
);

select throws_ok(
  $$
    insert into public.seller_verifications (
      seller_account_id,
      state,
      provider_reference,
      checked_at
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'verified',
      'verification-202',
      now()
    )
  $$,
  '23514',
  'new row for relation "seller_verifications" violates check constraint "seller_verifications_verified_fields_check"',
  'verified state requires a provider'
);

select throws_ok(
  $$
    insert into public.seller_verifications (
      seller_account_id,
      state,
      provider,
      checked_at
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'verified',
      'smile_identity',
      now()
    )
  $$,
  '23514',
  'new row for relation "seller_verifications" violates check constraint "seller_verifications_verified_fields_check"',
  'verified state requires a provider reference'
);

select throws_ok(
  $$
    insert into public.seller_verifications (
      seller_account_id,
      state,
      provider,
      provider_reference
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'verified',
      'smile_identity',
      'verification-202'
    )
  $$,
  '23514',
  'new row for relation "seller_verifications" violates check constraint "seller_verifications_verified_fields_check"',
  'verified state requires checked_at'
);

select throws_ok(
  $$
    insert into public.seller_verifications (
      seller_account_id,
      state,
      provider
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'in_progress',
      ' '
    )
  $$,
  '23514',
  'new row for relation "seller_verifications" violates check constraint "seller_verifications_provider_check"',
  'verification provider rejects blank strings'
);

select throws_ok(
  $$
    insert into public.seller_verifications (
      seller_account_id,
      state,
      provider,
      provider_reference
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'in_progress',
      'smile_identity',
      ' '
    )
  $$,
  '23514',
  'new row for relation "seller_verifications" violates check constraint "seller_verifications_provider_reference_check"',
  'verification provider reference rejects blank strings'
);

select lives_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider,
      status
    )
    values (
      '00000000-0000-0000-0000-000000000201',
      'paystack',
      'pending'
    )
  $$,
  'pending payment subaccount permits empty provider identifiers'
);

select throws_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider,
      status,
      provider_subaccount_code
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'paystack',
      'active',
      'ACCT_202'
    )
  $$,
  '23514',
  'new row for relation "payment_subaccounts" violates check constraint "payment_subaccounts_active_fields_check"',
  'active payment subaccount requires provider ID'
);

select throws_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider,
      status,
      provider_subaccount_id
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'paystack',
      'active',
      'subaccount-202'
    )
  $$,
  '23514',
  'new row for relation "payment_subaccounts" violates check constraint "payment_subaccounts_active_fields_check"',
  'active payment subaccount requires provider code'
);

select throws_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      ' '
    )
  $$,
  '23514',
  'new row for relation "payment_subaccounts" violates check constraint "payment_subaccounts_provider_check"',
  'payment provider rejects blank strings'
);

select throws_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider,
      provider_subaccount_id
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'paystack',
      ' '
    )
  $$,
  '23514',
  'new row for relation "payment_subaccounts" violates check constraint "payment_subaccounts_provider_id_check"',
  'payment provider ID rejects blank strings'
);

select throws_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider,
      provider_subaccount_code
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'paystack',
      ' '
    )
  $$,
  '23514',
  'new row for relation "payment_subaccounts" violates check constraint "payment_subaccounts_provider_code_check"',
  'payment provider code rejects blank strings'
);

select throws_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider,
      request_fingerprint
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'paystack',
      ' '
    )
  $$,
  '23514',
  'new row for relation "payment_subaccounts" violates check constraint "payment_subaccounts_request_fingerprint_check"',
  'payment request fingerprint rejects blank strings'
);

select throws_ok(
  $$
    insert into public.seller_entitlements (
      seller_account_id,
      plan_id,
      version,
      entitlements
    )
    select
      '00000000-0000-0000-0000-000000000201',
      id,
      2,
      entitlements
    from public.plans
    where code = 'free' and version = 1
  $$,
  '23503',
  'insert or update on table "seller_entitlements" violates foreign key constraint "seller_entitlements_plan_version_fkey"',
  'entitlement snapshot version must match its plan version'
);

select throws_ok(
  $$
    insert into public.seller_entitlements (
      seller_account_id,
      plan_id,
      version,
      entitlements
    )
    select
      '00000000-0000-0000-0000-000000000201',
      id,
      version,
      '[]'::jsonb
    from public.plans
    where code = 'free' and version = 1
  $$,
  '23514',
  'new row for relation "seller_entitlements" violates check constraint "seller_entitlements_entitlements_check"',
  'seller entitlement snapshot must be a JSON object'
);

insert into public.shops (
  id,
  seller_account_id,
  slug,
  display_name,
  country,
  currency
)
values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  'seller-one',
  'Seller One',
  'GH',
  'GHS'
);

select throws_ok(
  $$
    insert into public.shops (
      seller_account_id,
      slug,
      display_name,
      country,
      currency
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'seller-one',
      'Duplicate Slug',
      'NG',
      'NGN'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "shops_slug_key"',
  'shop slugs are unique'
);

select throws_ok(
  $$
    insert into public.shops (
      seller_account_id,
      slug,
      display_name,
      country,
      currency
    )
    values (
      '00000000-0000-0000-0000-000000000201',
      'seller-one-second',
      'Second Shop',
      'GH',
      'GHS'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "shops_seller_account_id_key"',
  'Foundation allows one shop per seller'
);

select throws_ok(
  $$
    insert into public.shops (
      seller_account_id,
      slug,
      display_name,
      country,
      currency
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'Invalid Slug',
      'Invalid Slug',
      'NG',
      'NGN'
    )
  $$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_slug_format_check"',
  'shop slug format rejects uppercase and spaces'
);

select throws_ok(
  $$
    insert into public.shops (
      seller_account_id,
      slug,
      display_name,
      country,
      currency
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'wrong-currency',
      'Wrong Currency',
      'NG',
      'GHS'
    )
  $$,
  '23503',
  'insert or update on table "shops" violates foreign key constraint "shops_country_currency_fkey"',
  'shop country and currency must match a supported config'
);

select throws_ok(
  $$
    insert into public.shops (
      seller_account_id,
      slug,
      display_name,
      country,
      currency
    )
    values (
      '00000000-0000-0000-0000-000000000202',
      'wrong-country',
      'Wrong Country',
      'GH',
      'GHS'
    )
  $$,
  '23503',
  'insert or update on table "shops" violates foreign key constraint "shops_seller_country_fkey"',
  'shop country must match its seller country'
);

create temporary table updated_at_before as
select updated_at
from public.plans
where code = 'free' and version = 1;

select pg_sleep(0.01);

update public.plans
set active = false
where code = 'free' and version = 1;

select is(
  (
    select active
    from public.plans
    where code = 'free' and version = 1
  ),
  false,
  'plan active status can be toggled operationally'
);

select ok(
  (
    select plans.updated_at > updated_at_before.updated_at
    from public.plans
    cross join updated_at_before
    where plans.code = 'free' and plans.version = 1
  ),
  'updated_at trigger advances the timestamp'
);

select lives_ok(
  $$
    select public.write_audit_event(
      'system',
      null,
      'foundation.tested',
      'plans',
      null,
      null,
      '{"result":"ok"}'::jsonb
    )
  $$,
  'audit helper writes a safe append-only event'
);

select throws_ok(
  $$
    update public.audit_events
    set action = 'foundation.changed'
    where action = 'foundation.tested'
  $$,
  '55000',
  'audit_events are append-only',
  'audit events cannot be updated'
);

select throws_ok(
  $$
    delete from public.audit_events
    where action = 'foundation.tested'
  $$,
  '55000',
  'audit_events are append-only',
  'audit events cannot be deleted'
);

select finish();

rollback;
