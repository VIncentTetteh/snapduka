begin;

set local search_path = extensions, public;

select no_plan();

select has_table(
  'public',
  'policy_acceptances',
  'policy acceptances table exists'
);
select has_table(
  'public',
  'settlement_profiles',
  'safe settlement profiles table exists'
);
select hasnt_column(
  'public',
  'settlement_profiles',
  'account_number',
  'settlement profiles never store the full account number'
);
select has_function(
  'public',
  'save_onboarding_shop',
  array['text', 'text', 'text', 'text']::name[],
  'transactional onboarding shop helper exists'
);
select has_function(
  'public',
  'bootstrap_seller_account',
  array['uuid', 'country_code', 'text', 'text']::name[],
  'verified auth seller bootstrap helper exists'
);
select has_function(
  'public',
  'reserve_payment_subaccount_request',
  array['uuid', 'uuid', 'text', 'jsonb']::name[],
  'payment reservation helper exists'
);
select has_function(
  'public',
  'record_payment_subaccount_provider_result',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'jsonb']::name[],
  'payment provider result helper exists'
);
select has_function(
  'public',
  'activate_payment_subaccount_request',
  array['uuid', 'uuid', 'uuid']::name[],
  'payment activation helper exists'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('policy_acceptances', 'settlement_profiles')
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  2::bigint,
  'onboarding tables force RLS'
);

select is(
  has_table_privilege('anon', 'public.policy_acceptances', 'SELECT'),
  false,
  'anonymous users cannot read policy acceptance'
);
select is(
  has_table_privilege('anon', 'public.settlement_profiles', 'SELECT'),
  false,
  'anonymous users cannot read settlement metadata'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reserve_payment_subaccount_request(uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot write provider reservations'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.record_payment_subaccount_provider_result(uuid,uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot write provider creation results'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.activate_payment_subaccount_request(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot activate provider results'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.bootstrap_seller_account(uuid,public.country_code,text,text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot bypass the trusted bootstrap action'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000003101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'onboarding@example.com',
    '',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000003102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'paused@example.com',
    '',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000003103',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'bootstrap@example.com',
    '',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000003104',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'unverified@example.com',
    '',
    null,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000003105',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'payment-gates@example.com',
    '',
    now(),
    '{}'::jsonb,
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
    '00000000-0000-0000-0000-000000003201',
    '00000000-0000-0000-0000-000000003101',
    'GH',
    'pending',
    false,
    'Onboarding Seller',
    'onboarding@example.com',
    '+233241234567'
  ),
  (
    '00000000-0000-0000-0000-000000003202',
    '00000000-0000-0000-0000-000000003102',
    'GH',
    'suspended',
    false,
    'Paused Seller',
    'paused@example.com',
    '+233241234568'
  ),
  (
    '00000000-0000-0000-0000-000000003205',
    '00000000-0000-0000-0000-000000003105',
    'GH',
    'pending',
    false,
    'Payment Gate Seller',
    'payment-gates@example.com',
    '+233241234570'
  );

set local role service_role;

select lives_ok(
  $$
    select public.bootstrap_seller_account(
      '00000000-0000-0000-0000-000000003103',
      'NG',
      'Bootstrap Seller',
      '+2348012345678'
    )
  $$,
  'trusted bootstrap creates a seller from a confirmed auth user'
);
select throws_ok(
  $$
    select public.bootstrap_seller_account(
      '00000000-0000-0000-0000-000000003104',
      'GH',
      'Unverified Seller',
      '+233241234569'
    )
  $$,
  '42501',
  'A verified auth email is required.',
  'trusted bootstrap refuses an unverified auth email'
);

reset role;

select results_eq(
  $$
    select country::text, contact_email
    from public.seller_accounts
    where auth_user_id = '00000000-0000-0000-0000-000000003103'
  $$,
  $$ values ('NG'::text, 'bootstrap@example.com'::text) $$,
  'bootstrap persists the verified auth email and selected country'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003101","app_metadata":{}}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    insert into public.settlement_profiles (
      seller_account_id,
      provider,
      bank_code,
      bank_name,
      account_last4
    )
    values (
      '00000000-0000-0000-0000-000000003201',
      'paystack',
      'GH001',
      'Example Bank',
      '6789'
    )
  $$,
  'pending seller can save safe settlement metadata without accepting policy'
);

select lives_ok(
  $$
    insert into public.policy_acceptances (
      seller_account_id,
      policy_key,
      policy_version
    )
    values (
      '00000000-0000-0000-0000-000000003201',
      'seller_terms',
      '2026-06-12'
    )
  $$,
  'pending seller can accept the current seller policy'
);

select lives_ok(
  $$
    select public.save_onboarding_shop(
      'Ama Market',
      'Ama Market',
      'Ama Market Limited',
      'CS123456'
    )
  $$,
  'seller can transactionally reserve a normalized draft slug'
);

select is(
  (
    select slug
    from public.shops
    where seller_account_id = '00000000-0000-0000-0000-000000003201'
  ),
  'ama-market',
  'shop helper persists lowercase hyphen slug'
);

reset role;

insert into public.shops (
  seller_account_id,
  slug,
  display_name,
  country,
  currency
)
values (
  '00000000-0000-0000-0000-000000003202',
  'paused-shop',
  'Paused Shop',
  'GH',
  'GHS'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003102","app_metadata":{}}',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.policy_acceptances),
  0::bigint,
  'suspended seller cannot see another seller policy acceptance'
);
select is(
  (select count(*) from public.settlement_profiles),
  0::bigint,
  'suspended seller cannot see another seller settlement profile'
);
select throws_ok(
  $$
    insert into public.policy_acceptances (
      seller_account_id,
      policy_key,
      policy_version
    )
    values (
      '00000000-0000-0000-0000-000000003202',
      'seller_terms',
      '2026-06-12'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "policy_acceptances"',
  'suspended seller cannot add policy acceptance'
);

reset role;

set local role service_role;

select throws_ok(
  $$
    select *
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003101',
      '00000000-0000-0000-0000-000000003205',
      'mismatch-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  '42501',
  'Payment seller ownership mismatch.',
  'reservation rejects a seller not owned by the supplied auth user'
);

select throws_ok(
  $$
    select *
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      'missing-policy-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  '55000',
  'Current seller policy acceptance is required.',
  'reservation rejects missing policy acceptance'
);

insert into public.policy_acceptances (
  seller_account_id,
  policy_key,
  policy_version,
  accepted_by_user_id
)
values (
  '00000000-0000-0000-0000-000000003205',
  'seller_terms',
  '2025-01-01',
  '00000000-0000-0000-0000-000000003105'
);

select throws_ok(
  $$
    select *
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      'outdated-policy-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  '55000',
  'Current seller policy acceptance is required.',
  'reservation rejects outdated policy acceptance'
);

insert into public.policy_acceptances (
  seller_account_id,
  policy_key,
  policy_version,
  accepted_by_user_id
)
values (
  '00000000-0000-0000-0000-000000003205',
  'seller_terms',
  '2026-06-12',
  '00000000-0000-0000-0000-000000003105'
);

select throws_ok(
  $$
    select *
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      'unverified-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  '55000',
  'Verified seller status is required.',
  'reservation rejects an unverified seller'
);

insert into public.seller_verifications (
  seller_account_id,
  state,
  provider,
  provider_reference,
  checked_at
)
values (
  '00000000-0000-0000-0000-000000003205',
  'verified',
  'test',
  'verified-payment-gates',
  now()
);

select throws_ok(
  $$
    select *
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      'missing-profile-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  '55000',
  'Safe settlement profile is required.',
  'reservation rejects an absent settlement profile'
);

insert into public.settlement_profiles (
  seller_account_id,
  provider,
  bank_code,
  bank_name,
  account_last4
)
values (
  '00000000-0000-0000-0000-000000003205',
  'paystack',
  'GH001',
  'Example Bank',
  '6789'
);

select throws_ok(
  $$
    select *
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      'missing-shop-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  '55000',
  'Draft shop identity is required.',
  'reservation rejects an absent shop identity'
);

insert into public.shops (
  seller_account_id,
  slug,
  display_name,
  legal_name,
  country,
  currency
)
values (
  '00000000-0000-0000-0000-000000003205',
  'payment-gate-shop',
  'Payment Gate Shop',
  'Payment Gate Shop Limited',
  'GH',
  'GHS'
);

select results_eq(
  $$
    select reservation_status
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      'eligible-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  $$ values ('reserved'::text) $$,
  'reservation accepts an eligible verified seller'
);

select lives_ok(
  $$
    select public.record_payment_subaccount_provider_result(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      (
        select id
        from public.payment_subaccounts
        where seller_account_id = '00000000-0000-0000-0000-000000003205'
      ),
      'provider-eligible',
      'ACCT_ELIGIBLE',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  'provider creation result is durably recorded while reservation remains pending'
);

select results_eq(
  $$
    select
      reservation_status,
      provider_subaccount_id,
      provider_subaccount_code,
      provider_metadata
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      'eligible-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  $$
    values (
      'provider_created'::text,
      'provider-eligible'::text,
      'ACCT_ELIGIBLE'::text,
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  'existing pending reservation exposes its safe recoverable provider result'
);

delete from public.policy_acceptances
where seller_account_id = '00000000-0000-0000-0000-000000003205'
  and policy_key = 'seller_terms'
  and policy_version = '2026-06-12';

select throws_ok(
  $$
    select public.activate_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      (
        select id
        from public.payment_subaccounts
        where seller_account_id = '00000000-0000-0000-0000-000000003205'
      )
    )
  $$,
  '55000',
  'Current seller policy acceptance is required.',
  'activation rechecks current policy acceptance'
);

insert into public.policy_acceptances (
  seller_account_id,
  policy_key,
  policy_version,
  accepted_by_user_id
)
values (
  '00000000-0000-0000-0000-000000003205',
  'seller_terms',
  '2026-06-12',
  '00000000-0000-0000-0000-000000003105'
);

update public.settlement_profiles
set bank_name = 'Changed Bank'
where seller_account_id = '00000000-0000-0000-0000-000000003205'
  and provider = 'paystack';

select throws_ok(
  $$
    select public.activate_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      (
        select id
        from public.payment_subaccounts
        where seller_account_id = '00000000-0000-0000-0000-000000003205'
      )
    )
  $$,
  '22023',
  'Persisted provider result does not match locked settlement facts.',
  'activation rejects provider metadata that differs from the locked settlement profile'
);

update public.settlement_profiles
set bank_name = 'Example Bank'
where seller_account_id = '00000000-0000-0000-0000-000000003205'
  and provider = 'paystack';

select lives_ok(
  $$
    select public.activate_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003105',
      '00000000-0000-0000-0000-000000003205',
      (
        select id
        from public.payment_subaccounts
        where seller_account_id = '00000000-0000-0000-0000-000000003205'
      )
    )
  $$,
  'provider activation persists through the trusted RPC'
);

select is(
  (
    select status::text
    from public.payment_subaccounts
    where seller_account_id = '00000000-0000-0000-0000-000000003205'
  ),
  'active',
  'activation marks the reserved provider record active'
);

reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003105","app_metadata":{}}',
  true
);
set local role authenticated;

update public.settlement_profiles
set bank_name = 'Owner Changed Bank'
where seller_account_id = '00000000-0000-0000-0000-000000003205'
  and provider = 'paystack';

select is(
  (
    select bank_name
    from public.settlement_profiles
    where seller_account_id = '00000000-0000-0000-0000-000000003205'
      and provider = 'paystack'
  ),
  'Example Bank',
  'owner cannot update settlement facts after activation'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    select *
    from public.reserve_payment_subaccount_request(
      '00000000-0000-0000-0000-000000003102',
      '00000000-0000-0000-0000-000000003202',
      'suspended-fingerprint',
      '{"bankCode":"GH001","bankName":"Example Bank","accountLast4":"6789","country":"GH"}'::jsonb
    )
  $$,
  '55000',
  'Seller account is not eligible for payment setup.',
  'reservation rejects a suspended seller'
);

reset role;

select throws_ok(
  $$
    insert into public.settlement_profiles (
      seller_account_id,
      provider,
      bank_code,
      bank_name,
      account_last4,
      metadata
    )
    values (
      '00000000-0000-0000-0000-000000003201',
      'paystack',
      'GH001',
      'Example Bank',
      '6789',
      '{"accountNumber":"0123456789"}'::jsonb
    )
  $$,
  '23514',
  null,
  'sensitive account fields are rejected from generic metadata'
);

select * from finish();

rollback;
