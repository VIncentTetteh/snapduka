-- A seller must never see another shop's buyers — or any buyer's profile.
--
-- buyer_profiles / buyer_addresses / buyer_payment_methods (202609250170) are
-- owner-only. This pins that as behaviour, not as a policy listing, for every
-- seller-side shape that has bitten us before (snapduka-authz-boundaries,
-- snapduka-rls-suspension-and-teams): an owner, a team member (who resolves as
-- a seller carrying the OWNER's id), and a suspended seller. It also covers the
-- person who is both a seller and a buyer: they see their own profile and
-- nothing of their customers'.

begin;

set local search_path = extensions, public;

select plan(27);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, phone, phone_confirmed_at, created_at, updated_at) values
 ('70700000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,'233241170001',now(),now(),now()),
 ('70700000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,'233241170002',now(),now(),now()),
 ('70700000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@buyer-iso.test','233241170003',now(),now(),now()),
 ('70700000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manager@buyer-iso.test',null,null,now(),now()),
 ('70700000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','suspended@buyer-iso.test',null,null,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name) values
 ('70700000-0000-4000-8000-000000000101','70700000-0000-4000-8000-000000000003','GH','active',true,'Owner Seller'),
 ('70700000-0000-4000-8000-000000000102','70700000-0000-4000-8000-000000000005','GH','suspended',false,'Suspended Seller');

insert into public.team_memberships (seller_account_id, auth_user_id, email, role, active) values
 ('70700000-0000-4000-8000-000000000101','70700000-0000-4000-8000-000000000004','manager@buyer-iso.test','manager',true);

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status) values
 ('70700000-0000-4000-8000-000000000201','70700000-0000-4000-8000-000000000101','buyer-iso-owner','Owner Shop','GH','GHS','draft'),
 ('70700000-0000-4000-8000-000000000202','70700000-0000-4000-8000-000000000102','buyer-iso-susp','Suspended Shop','GH','GHS','draft');

insert into public.customers (id, seller_account_id, name, email, phone, country) values
 ('70700000-0000-4000-8000-000000000301','70700000-0000-4000-8000-000000000101','Ama','ama@buyer-iso.test','+233241170001','GH'),
 ('70700000-0000-4000-8000-000000000302','70700000-0000-4000-8000-000000000102','Ama','ama@buyer-iso.test','+233241170001','GH');

insert into public.buyer_profiles (id, auth_user_id, phone_e164, display_name, consent_shared_profile_at, consent_version) values
 ('70700000-0000-4000-8000-000000000401','70700000-0000-4000-8000-000000000001','+233241170001','Ama',now(),'2026-09'),
 ('70700000-0000-4000-8000-000000000402','70700000-0000-4000-8000-000000000002','+233241170002','Kofi',now(),'2026-09'),
 -- The seller who is also a buyer.
 ('70700000-0000-4000-8000-000000000403','70700000-0000-4000-8000-000000000003','+233241170003','Owner as buyer',null,null);

insert into public.buyer_addresses (id, buyer_profile_id, line1, city, country) values
 ('70700000-0000-4000-8000-000000000501','70700000-0000-4000-8000-000000000401','1 Ama Street','Accra','GH'),
 ('70700000-0000-4000-8000-000000000502','70700000-0000-4000-8000-000000000402','2 Kofi Road','Kumasi','GH');

insert into public.buyer_payment_methods (buyer_profile_id, provider, method, momo_network, msisdn_masked, provider_token_sealed) values
 ('70700000-0000-4000-8000-000000000401','paystack','momo','mtn','024****001','v1.aXY=.dGFn.ZGF0YQ==');

insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot, buyer_profile_id) values
 ('70700000-0000-4000-8000-000000000601','70700000-0000-4000-8000-000000000201','70700000-0000-4000-8000-000000000101',
  '70700000-0000-4000-8000-000000000301','GHS',1000,0,1000,'cash_on_delivery','{}'::jsonb,
  '{"name":"Ama","phone":"+233241170001","country":"GH"}'::jsonb,'70700000-0000-4000-8000-000000000401'),
 ('70700000-0000-4000-8000-000000000602','70700000-0000-4000-8000-000000000202','70700000-0000-4000-8000-000000000102',
  '70700000-0000-4000-8000-000000000302','GHS',2000,0,2000,'cash_on_delivery','{}'::jsonb,
  '{"name":"Ama","phone":"+233241170001","country":"GH"}'::jsonb,'70700000-0000-4000-8000-000000000401');

update public.customers set buyer_profile_id = '70700000-0000-4000-8000-000000000401'
 where id in ('70700000-0000-4000-8000-000000000301','70700000-0000-4000-8000-000000000302');

-- ── The buyer: own rows only ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"70700000-0000-4000-8000-000000000001","role":"authenticated"}';

select results_eq($$ select id from public.buyer_profiles $$,
  $$ values ('70700000-0000-4000-8000-000000000401'::uuid) $$,
  'a buyer reads exactly their own profile');
select results_eq($$ select id from public.buyer_addresses $$,
  $$ values ('70700000-0000-4000-8000-000000000501'::uuid) $$,
  'a buyer reads only their own addresses');
select throws_ok(
  $$ insert into public.buyer_addresses (buyer_profile_id, line1, city, country)
     values ('70700000-0000-4000-8000-000000000402','Planted','Accra','GH') $$,
  '42501', null, 'a buyer cannot write into another buyer''s address book');
-- Silently matches nothing under RLS; asserted after `reset role` below.
update public.buyer_addresses set line1 = 'Hijacked' where id = '70700000-0000-4000-8000-000000000502';
select throws_ok(
  $$ update public.buyer_profiles set default_address_id = '70700000-0000-4000-8000-000000000502'
     where id = '70700000-0000-4000-8000-000000000401' $$,
  '23514', null, 'a default address must be one of the buyer''s own');
select throws_ok($$ update public.buyer_profiles set phone_e164 = '+233200000000' $$,
  '42501', null, 'the verified phone cannot be edited by the client');
select throws_ok($$ update public.buyer_profiles set consent_shared_profile_at = now() $$,
  '42501', null, 'consent is only recorded through the audited function');
select throws_ok(
  $$ insert into public.buyer_profiles (auth_user_id, phone_e164) values ('70700000-0000-4000-8000-000000000001','+233200000001') $$,
  '42501', null, 'profiles are only created by bootstrap_buyer_profile');
select throws_ok($$ select provider_token_sealed from public.buyer_payment_methods $$,
  '42501', null, 'even the owner cannot read a sealed payment token');
select is((select count(*)::int from public.buyer_payment_methods), 1,
  'the owner sees their saved payment method without the token');
select is((select count(*)::int from public.buyer_order_history()), 2,
  'the buyer sees orders from both shops in one history');
select throws_ok($$ select public.link_order_to_buyer('70700000-0000-4000-8000-000000000601','70700000-0000-4000-8000-000000000401') $$,
  '42501', null, 'link_order_to_buyer is not callable from a client');

reset role;

select is((select line1 from public.buyer_addresses where id = '70700000-0000-4000-8000-000000000502'), '2 Kofi Road',
  'a buyer cannot edit another buyer''s address');

-- ── The seller who is also a buyer ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"70700000-0000-4000-8000-000000000003","role":"authenticated"}';

select results_eq($$ select id from public.buyer_profiles $$,
  $$ values ('70700000-0000-4000-8000-000000000403'::uuid) $$,
  'a seller who is also a buyer sees only their own buyer profile');
select is((select count(*)::int from public.buyer_addresses), 0,
  'a seller cannot read their customers'' saved addresses');
select is((select count(*)::int from public.buyer_payment_methods), 0,
  'a seller cannot read their customers'' saved payment methods');
select is((select count(*)::int from public.orders o join public.buyer_profiles p on p.id = o.buyer_profile_id), 0,
  'a seller cannot join their own orders to a buyer profile');
select is((select count(*)::int from public.buyer_order_history()), 0,
  'a seller''s buyer history does not include orders placed at their shop');

reset role;

-- ── A team member (resolves as the owner's seller) ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"70700000-0000-4000-8000-000000000004","role":"authenticated"}';

select is((select count(*)::int from public.orders where seller_account_id = '70700000-0000-4000-8000-000000000101'), 1,
  'control: the manager can read the shop''s order');
select is((select count(*)::int from public.buyer_profiles), 0, 'a team member reads no buyer profile');
select is((select count(*)::int from public.buyer_addresses), 0, 'a team member reads no buyer address');
select is((select count(*)::int from public.customers c join public.buyer_profiles p on p.id = c.buyer_profile_id), 0,
  'a team member cannot resolve a customer to a buyer profile');

reset role;

-- ── A suspended seller ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"70700000-0000-4000-8000-000000000005","role":"authenticated"}';

select is((select count(*)::int from public.buyer_profiles), 0, 'a suspended seller reads no buyer profile');
select is((select count(*)::int from public.buyer_addresses), 0, 'a suspended seller reads no buyer address');
select is((select count(*)::int from public.buyer_payment_methods), 0, 'a suspended seller reads no payment method');

reset role;

-- ── Anonymous ───────────────────────────────────────────────────────────────
set local role anon;
select throws_ok($$ select 1 from public.buyer_profiles $$, '42501', null, 'anon has no access to buyer profiles');
reset role;

-- ── Structural guarantees ───────────────────────────────────────────────────
select is((
  select count(*)::int from pg_policies
   where schemaname = 'public' and tablename like 'buyer\_%'
     and (roles <> '{authenticated}'
          or coalesce(qual, '') ~ '(seller|team_has_role|is_operator)'
          or coalesce(with_check, '') ~ '(seller|team_has_role|is_operator)')), 0,
  'no buyer_* policy grants anything to a seller, a team or an operator');

-- The PGRST201 lesson: exactly one single-column FK from each table.
select is((
  select count(*)::int from pg_constraint
   where contype = 'f' and confrelid = 'public.buyer_profiles'::regclass
     and conrelid in ('public.orders'::regclass, 'public.customers'::regclass)
     and array_length(conkey, 1) = 1), 2,
  'orders and customers each carry one single-column FK to buyer_profiles');

select * from finish();
rollback;
