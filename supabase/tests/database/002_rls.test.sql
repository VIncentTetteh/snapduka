begin;

set local search_path = extensions, public;

select no_plan();

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
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'pending@example.com',
    '',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'active@example.com',
    '',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001103',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'suspended@example.com',
    '',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001104',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'operator@example.com',
    '',
    now(),
    '{"snapduka_role":"operator"}'::jsonb,
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
  contact_email
)
values
  (
    '00000000-0000-0000-0000-000000001201',
    '00000000-0000-0000-0000-000000001101',
    'GH',
    'pending',
    false,
    'Pending Seller',
    'pending@example.com'
  ),
  (
    '00000000-0000-0000-0000-000000001202',
    '00000000-0000-0000-0000-000000001102',
    'NG',
    'active',
    true,
    'Active Seller',
    'active@example.com'
  ),
  (
    '00000000-0000-0000-0000-000000001203',
    '00000000-0000-0000-0000-000000001103',
    'GH',
    'suspended',
    false,
    'Suspended Seller',
    'suspended@example.com'
  );

insert into public.plans (
  code,
  name,
  version,
  entitlements,
  active
)
values (
  'retired',
  'Retired',
  1,
  '{"shops":99}'::jsonb,
  false
);

insert into public.shops (
  id,
  seller_account_id,
  slug,
  display_name,
  country,
  currency,
  status,
  published_at
)
values
  (
    '00000000-0000-0000-0000-000000001301',
    '00000000-0000-0000-0000-000000001201',
    'pending-shop',
    'Pending Shop',
    'GH',
    'GHS',
    'draft',
    null
  ),
  (
    '00000000-0000-0000-0000-000000001302',
    '00000000-0000-0000-0000-000000001202',
    'published-shop',
    'Published Shop',
    'NG',
    'NGN',
    'published',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001303',
    '00000000-0000-0000-0000-000000001203',
    'suspended-shop',
    'Suspended Shop',
    'GH',
    'GHS',
    'suspended',
    null
  );

insert into public.seller_verifications (
  id,
  seller_account_id,
  state
)
values
  (
    '00000000-0000-0000-0000-000000001401',
    '00000000-0000-0000-0000-000000001201',
    'not_started'
  ),
  (
    '00000000-0000-0000-0000-000000001402',
    '00000000-0000-0000-0000-000000001202',
    'not_started'
  ),
  (
    '00000000-0000-0000-0000-000000001403',
    '00000000-0000-0000-0000-000000001203',
    'suspended'
  );

insert into public.payment_subaccounts (
  id,
  seller_account_id,
  provider,
  status
)
values
  (
    '00000000-0000-0000-0000-000000001501',
    '00000000-0000-0000-0000-000000001202',
    'paystack',
    'pending'
  ),
  (
    '00000000-0000-0000-0000-000000001502',
    '00000000-0000-0000-0000-000000001203',
    'paystack',
    'restricted'
  );

insert into public.seller_entitlements (
  id,
  seller_account_id,
  plan_id,
  version,
  entitlements
)
select
  '00000000-0000-0000-0000-000000001601',
  '00000000-0000-0000-0000-000000001203',
  id,
  version,
  entitlements
from public.plans
where code = 'free' and active;

insert into public.audit_events (
  actor_type,
  actor_id,
  action,
  entity_type,
  entity_id
)
values (
  'admin',
  '00000000-0000-0000-0000-000000001104',
  'seller.reviewed',
  'seller_account',
  '00000000-0000-0000-0000-000000001203'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'audit_events',
        'country_configs',
        'payment_subaccounts',
        'plans',
        'seller_accounts',
        'seller_entitlements',
        'seller_verifications',
        'shops'
      )
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  8::bigint,
  'RLS is enabled and forced on every current public table'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'audit_events_operator_read',
        'country_configs_operator_read',
        'country_configs_public_read',
        'payment_subaccounts_owner_insert',
        'payment_subaccounts_owner_operator_read',
        'payment_subaccounts_owner_update',
        'plans_active_read',
        'plans_operator_read',
        'seller_accounts_owner_or_operator_read',
        'seller_accounts_owner_update',
        'seller_entitlements_owner_insert',
        'seller_entitlements_owner_operator_read',
        'seller_entitlements_owner_update',
        'seller_verifications_owner_insert',
        'seller_verifications_owner_operator_read',
        'seller_verifications_owner_update',
        'shops_owner_insert',
        'shops_owner_operator_read',
        'shops_owner_update',
        'shops_public_read'
      )
  ),
  20::bigint,
  'the expected RLS policies exist'
);

select has_function(
  'public',
  'current_seller_account_id',
  array[]::name[],
  'seller identity helper exists'
);
select has_function(
  'public',
  'current_seller_status',
  array[]::name[],
  'seller status helper exists'
);
select has_function(
  'public',
  'is_operator',
  array[]::name[],
  'operator claim helper exists'
);

create table public.rls_default_table_probe (id integer);
create function public.rls_default_function_probe()
returns boolean
language sql
as $$ select true $$;

select is(
  has_table_privilege('anon', 'public.rls_default_table_probe', 'SELECT'),
  false,
  'future public tables do not default to anonymous read access'
);
select is(
  has_table_privilege(
    'authenticated',
    'public.rls_default_table_probe',
    'SELECT'
  ),
  false,
  'future public tables do not default to authenticated read access'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.rls_default_function_probe()',
    'EXECUTE'
  ),
  false,
  'future public functions do not default to authenticated execution'
);

drop function public.rls_default_function_probe();
drop table public.rls_default_table_probe;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select is(
  (select count(*) from public.country_configs),
  3::bigint,
  'anonymous users can read supported country configuration'
);
select is(
  (select count(*) from public.plans),
  3::bigint,
  'anonymous users can read all active plan versions'
);
select results_eq(
  $$
    select slug
    from public.shops
    order by slug
  $$,
  $$ values ('published-shop'::text) $$,
  'anonymous users can read only published shops'
);
select throws_ok(
  $$ select count(*) from public.seller_accounts $$,
  '42501',
  'permission denied for table seller_accounts',
  'anonymous users cannot enumerate seller accounts'
);
select throws_ok(
  $$ select count(*) from public.seller_verifications $$,
  '42501',
  'permission denied for table seller_verifications',
  'anonymous users cannot enumerate verifications'
);
select throws_ok(
  $$ select count(*) from public.payment_subaccounts $$,
  '42501',
  'permission denied for table payment_subaccounts',
  'anonymous users cannot enumerate payment subaccounts'
);
select throws_ok(
  $$ select count(*) from public.seller_entitlements $$,
  '42501',
  'permission denied for table seller_entitlements',
  'anonymous users cannot enumerate entitlements'
);
select throws_ok(
  $$ select count(*) from public.audit_events $$,
  '42501',
  'permission denied for table audit_events',
  'anonymous users cannot enumerate audit events'
);

reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000001101","app_metadata":{}}',
  true
);
set local role authenticated;

select is(
  public.current_seller_account_id(),
  '00000000-0000-0000-0000-000000001201'::uuid,
  'seller identity derives from auth.uid()'
);
select is(
  public.current_seller_status()::text,
  'pending',
  'seller status derives from the owned seller record'
);
select is(
  (select count(*) from public.seller_accounts),
  1::bigint,
  'seller can read only their seller account'
);
select is_empty(
  $$
    select id
    from public.seller_accounts
    where id = '00000000-0000-0000-0000-000000001202'
  $$,
  'seller A cannot read seller B account'
);
select is(
  (select count(*) from public.seller_verifications),
  1::bigint,
  'seller can read their verification'
);
select is_empty(
  $$
    select id
    from public.seller_verifications
    where seller_account_id = '00000000-0000-0000-0000-000000001202'
  $$,
  'seller A cannot read seller B verification'
);
select lives_ok(
  $$
    update public.shops
    set display_name = 'Pending Shop Updated'
    where id = '00000000-0000-0000-0000-000000001301'
  $$,
  'pending seller can update their draft shop'
);
select throws_ok(
  $$
    update public.shops
    set status = 'published', published_at = now()
    where id = '00000000-0000-0000-0000-000000001301'
  $$,
  '42501',
  'new row violates row-level security policy for table "shops"',
  'pending seller cannot publish a shop'
);
select lives_ok(
  $$
    update public.shops
    set display_name = 'Hacked'
    where id = '00000000-0000-0000-0000-000000001302'
  $$,
  'cross-seller shop update is filtered by RLS'
);
select throws_ok(
  $$
    insert into public.shops (
      seller_account_id,
      slug,
      display_name,
      country,
      currency,
      status
    )
    values (
      '00000000-0000-0000-0000-000000001202',
      'stolen-shop',
      'Stolen Shop',
      'NG',
      'NGN',
      'draft'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "shops"',
  'seller A cannot insert a shop for seller B'
);
select lives_ok(
  $$
    update public.seller_verifications
    set state = 'in_progress', metadata = '{"submitted":true}'::jsonb
    where seller_account_id = '00000000-0000-0000-0000-000000001201'
  $$,
  'pending seller can update their non-authoritative verification input'
);
select lives_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider,
      metadata
    )
    values (
      '00000000-0000-0000-0000-000000001201',
      'paystack',
      '{"submitted":true}'::jsonb
    )
  $$,
  'pending seller can create their own pending setup record'
);
select lives_ok(
  $$
    insert into public.seller_entitlements (
      seller_account_id,
      plan_id,
      version,
      entitlements
    )
    select
      '00000000-0000-0000-0000-000000001201',
      id,
      version,
      entitlements
    from public.plans
    where code = 'free' and active
  $$,
  'pending seller can assign only the canonical free entitlement'
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
      '00000000-0000-0000-0000-000000001201',
      id,
      version,
      '{"shops":999}'::jsonb
    from public.plans
    where code = 'free' and active
  $$,
  '42501',
  'new row violates row-level security policy for table "seller_entitlements"',
  'seller cannot grant themselves spoofed entitlements'
);
select is(
  public.is_operator(),
  false,
  'ordinary seller is not an operator'
);
select is(
  (select count(*) from public.audit_events),
  0::bigint,
  'ordinary seller cannot read audit events'
);
select throws_ok(
  $$
    insert into public.audit_events (
      actor_type,
      actor_id,
      action,
      entity_type
    )
    values (
      'admin',
      '00000000-0000-0000-0000-000000001101',
      'operator.spoofed',
      'seller_account'
    )
  $$,
  '42501',
  'permission denied for table audit_events',
  'ordinary seller cannot insert spoofed audit events'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.write_audit_event(public.actor_type,uuid,text,text,uuid,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  false,
  'ordinary authenticated users cannot execute write_audit_event'
);
select is(
  has_table_privilege('service_role', 'public.audit_events', 'INSERT'),
  true,
  'service role can append audit events'
);
select is(
  has_table_privilege('service_role', 'public.audit_events', 'TRUNCATE'),
  false,
  'service role cannot truncate the audit log'
);

reset role;

select is(
  (
    select display_name
    from public.shops
    where id = '00000000-0000-0000-0000-000000001302'
  ),
  'Published Shop',
  'seller A did not update seller B shop'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000001102","app_metadata":{}}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    update public.shops
    set status = 'draft'
    where seller_account_id = '00000000-0000-0000-0000-000000001202'
  $$,
  'active seller can move their shop back to draft'
);
select lives_ok(
  $$
    update public.shops
    set status = 'published', published_at = now()
    where seller_account_id = '00000000-0000-0000-0000-000000001202'
  $$,
  'active seller can publish their own shop'
);

reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000001103","app_metadata":{}}',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.seller_accounts),
  1::bigint,
  'suspended seller can read their account'
);
select lives_ok(
  $$
    update public.seller_accounts
    set contact_phone = '+233200000099'
    where id = '00000000-0000-0000-0000-000000001203'
  $$,
  'suspended seller can update an allowed contact field'
);
select throws_ok(
  $$
    update public.seller_accounts
    set status = 'active', is_active = true
    where id = '00000000-0000-0000-0000-000000001203'
  $$,
  '42501',
  'permission denied for table seller_accounts',
  'suspended seller cannot update status or active state'
);
select is(
  (
    select status::text
    from public.shops
    where seller_account_id = '00000000-0000-0000-0000-000000001203'
  ),
  'suspended',
  'suspended seller can read their suspended shop'
);
select lives_ok(
  $$
    update public.shops
    set status = 'published', published_at = now()
    where seller_account_id = '00000000-0000-0000-0000-000000001203'
  $$,
  'suspended shop mutation is filtered without leaking the row'
);
select throws_ok(
  $$
    insert into public.payment_subaccounts (
      seller_account_id,
      provider
    )
    values (
      '00000000-0000-0000-0000-000000001203',
      'other_provider'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "payment_subaccounts"',
  'suspended seller cannot create new payment setup'
);

reset role;

select is(
  (
    select status::text
    from public.shops
    where id = '00000000-0000-0000-0000-000000001303'
  ),
  'suspended',
  'suspended seller could not publish their shop'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000001101","app_metadata":{},"user_metadata":{"snapduka_role":"operator"}}',
  true
);
set local role authenticated;

select is(
  public.is_operator(),
  false,
  'user metadata cannot spoof the operator role'
);
select is(
  (select count(*) from public.audit_events),
  0::bigint,
  'spoofed user metadata does not expose audits'
);

reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000001104","app_metadata":{"snapduka_role":"operator"}}',
  true
);
set local role authenticated;

select is(public.is_operator(), true, 'verified app metadata identifies operator');
select is(
  (select count(*) from public.seller_accounts),
  3::bigint,
  'operator can read seller accounts across sellers'
);
select is(
  (select count(*) from public.shops),
  3::bigint,
  'operator can read published and unpublished shops'
);
select is(
  (select count(*) from public.seller_verifications),
  3::bigint,
  'operator can read verifications across sellers'
);
select is(
  (select count(*) from public.payment_subaccounts),
  3::bigint,
  'operator can read payment setup across sellers'
);
select is(
  (select count(*) from public.seller_entitlements),
  2::bigint,
  'operator can read entitlements across sellers'
);
select is(
  (select count(*) from public.audit_events),
  1::bigint,
  'operator can read audit events'
);
select lives_ok(
  $$
    update public.seller_accounts
    set contact_name = 'Operator Mutation'
    where id = '00000000-0000-0000-0000-000000001202'
  $$,
  'operator seller mutation is filtered by RLS'
);
select throws_ok(
  $$
    insert into public.audit_events (
      actor_type,
      actor_id,
      action,
      entity_type
    )
    values (
      'admin',
      '00000000-0000-0000-0000-000000001104',
      'operator.direct_write',
      'seller_account'
    )
  $$,
  '42501',
  'permission denied for table audit_events',
  'operator cannot directly insert audit events'
);

reset role;

select is(
  (
    select contact_name
    from public.seller_accounts
    where id = '00000000-0000-0000-0000-000000001202'
  ),
  'Active Seller',
  'operator did not mutate the seller account'
);

select * from finish();

rollback;
