-- Rollout switches for money features: resolution order and access are pinned
-- here because a wrong answer turns Protect on for a market that is not ready.

begin;

set local search_path = extensions, public;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('49490000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'flags-gh@test', now(), now()),
  ('49490000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'flags-ng@test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values
  ('49490000-0000-4000-8000-0000000000a1', '49490000-0000-4000-8000-000000000001',
   'GH', 'active', true, 'GH Seller'),
  ('49490000-0000-4000-8000-0000000000a2', '49490000-0000-4000-8000-000000000002',
   'NG', 'active', true, 'NG Seller');

select ok(not public.evaluate_feature_flag('protect', '49490000-0000-4000-8000-0000000000a1'),
  'an unknown flag is off');

insert into public.feature_flags (key, enabled) values ('protect', true);
select ok(public.evaluate_feature_flag('protect', '49490000-0000-4000-8000-0000000000a2'),
  'a global row applies everywhere');

insert into public.feature_flags (key, country_code, enabled) values ('protect', 'NG', false);
select ok(not public.evaluate_feature_flag('protect', '49490000-0000-4000-8000-0000000000a2'),
  'a country row overrides the global row');
select ok(public.evaluate_feature_flag('protect', '49490000-0000-4000-8000-0000000000a1'),
  'another country still follows the global row');
select ok(not public.evaluate_feature_flag('protect', null, 'NG'),
  'country-only evaluation uses the country row');

insert into public.feature_flags (key, seller_account_id, enabled)
values ('protect', '49490000-0000-4000-8000-0000000000a2', true);
select ok(public.evaluate_feature_flag('protect', '49490000-0000-4000-8000-0000000000a2'),
  'a seller row beats its country row (pilot cohort)');

-- Percentage rollout is deterministic per seller and never on without a seller.
insert into public.feature_flags (key, enabled, percentage) values ('wa_agent', true, 0);
select ok(not public.evaluate_feature_flag('wa_agent', '49490000-0000-4000-8000-0000000000a1'),
  '0% is off for everyone');
update public.feature_flags set percentage = 50 where key = 'wa_agent';
select is(
  public.evaluate_feature_flag('wa_agent', '49490000-0000-4000-8000-0000000000a1'),
  public.feature_flag_bucket('wa_agent', '49490000-0000-4000-8000-0000000000a1') < 50,
  'a partial rollout buckets by hash of key and seller');
select ok(not public.evaluate_feature_flag('wa_agent', null, 'GH'),
  'a partial rollout with no seller to bucket is off');

select throws_ok(
  $$insert into public.feature_flags (key, country_code, seller_account_id, enabled)
    values ('x_flag', 'GH', '49490000-0000-4000-8000-0000000000a1', true)$$,
  '23514', null, 'a row targets exactly one scope');

select ok(not has_table_privilege('authenticated', 'public.feature_flags', 'select'),
  'sellers cannot read rollout plans');
select ok(not has_function_privilege('authenticated',
  'public.evaluate_feature_flag(text,uuid,public.country_code)', 'execute'),
  'clients learn flags from the server, not by calling the evaluator');

select * from finish();
rollback;
