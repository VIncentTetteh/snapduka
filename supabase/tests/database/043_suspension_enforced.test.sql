-- Suspension has to mean something in the database, not just in the web app.
--
-- Both mobile clients write straight to PostgREST with the user's JWT, so an
-- application-layer check protects neither of them. Before 202609050089 a
-- suspended seller could mint an API key, create a discount code, register a
-- webhook and re-list themselves in public discovery.
--
-- The subtler half: sixteen policies already carried a status test, but only in
-- USING. For an ALL policy INSERT is governed by WITH CHECK alone, so a
-- suspended seller could not read or update their collections and could still
-- insert new ones. Both halves are asserted here.

begin;

set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('0dd00000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'suspended@rls.test', now(), now()),
       ('0dd00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pending@rls.test', now(), now());

-- seller_accounts_active_status_check: is_active must equal (status = 'active').
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('0dd00000-0000-4000-8000-000000000002', '0dd00000-0000-4000-8000-000000000001',
        'GH', 'suspended', false, 'Suspended Seller'),
       ('0dd00000-0000-4000-8000-00000000000b', '0dd00000-0000-4000-8000-00000000000a',
        'GH', 'pending', false, 'Pending Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status)
values ('0dd00000-0000-4000-8000-000000000003', '0dd00000-0000-4000-8000-000000000002',
        'suspended-shop', 'Suspended Shop', 'GH', 'GHS', 'draft'),
       ('0dd00000-0000-4000-8000-00000000000c', '0dd00000-0000-4000-8000-00000000000b',
        'pending-shop', 'Pending Shop', 'GH', 'GHS', 'draft');

-- ── A suspended seller cannot keep operating ───────────────────────────────
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000001","role":"authenticated"}';
     insert into public.api_keys (seller_account_id, name, key_prefix, key_hash, scopes)
     values ('0dd00000-0000-4000-8000-000000000002','k','sk_test','hash','{}') $$,
  '42501',
  NULL,
  'a suspended seller cannot mint an API key'
);

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000001","role":"authenticated"}';
     insert into public.promotions (seller_account_id, shop_id, name, code, kind, value, active)
     values ('0dd00000-0000-4000-8000-000000000002','0dd00000-0000-4000-8000-000000000003',
             'P','SUSP10',(enum_range(null::public.discount_kind))[1],10,true) $$,
  '42501',
  NULL,
  'a suspended seller cannot create a discount code'
);

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000001","role":"authenticated"}';
     insert into public.discovery_preferences (seller_account_id, shop_id, opted_in)
     values ('0dd00000-0000-4000-8000-000000000002','0dd00000-0000-4000-8000-000000000003',true) $$,
  '42501',
  NULL,
  'a suspended seller cannot re-list themselves in public discovery'
);

-- The WITH CHECK gap: this table always had a status test in USING, and a
-- suspended seller could insert into it anyway.
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000001","role":"authenticated"}';
     insert into public.collections (seller_account_id, shop_id, name, slug)
     values ('0dd00000-0000-4000-8000-000000000002','0dd00000-0000-4000-8000-000000000003','C','susp-col') $$,
  '42501',
  NULL,
  'a status test in USING alone does not let a suspended seller insert'
);

-- ── Onboarding must not be collateral damage ───────────────────────────────
-- 'pending' is every seller between signup and verification. Refusing them
-- would break the product for every new account, so the predicate admits both
-- pending and active.
select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-00000000000a","role":"authenticated"}';
     insert into public.collections (seller_account_id, shop_id, name, slug)
     values ('0dd00000-0000-4000-8000-00000000000b','0dd00000-0000-4000-8000-00000000000c','Onboarding','pend-col') $$,
  'a pending seller can still set their shop up'
);

-- ── The property, so a new policy cannot quietly reintroduce the gap ───────
select is_empty(
  $$ select tablename || '.' || policyname
     from pg_policies
     where schemaname = 'public'
       and cmd in ('ALL','INSERT','UPDATE','DELETE')
       and (coalesce(qual,'') || coalesce(with_check,'')) like '%current_seller_account_id()%'
       and policyname not in (
         'seller_accounts_owner_update','notifications_owner_mark_read','preferences_owner_all',
         'social_accounts_owner_delete','exports_owner_all','courier_quotes_owner_all')
       and ((qual is not null and qual not like '%current_seller_status%')
         or (with_check is not null and with_check not like '%current_seller_status%')) $$,
  'every owner write policy tests account status, in both directions'
);

-- Disconnecting a social account is de-escalation and stays available to a
-- suspended seller: containment should not trap someone.
select ok(
  (select count(*) from pg_policies
   where schemaname = 'public' and policyname = 'social_accounts_owner_delete'
     and coalesce(qual,'') not like '%current_seller_status%') = 1,
  'a suspended seller can still disconnect a social account'
);

select * from finish();
rollback;
