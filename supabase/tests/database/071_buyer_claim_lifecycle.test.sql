-- Buyer lifecycle: bootstrap -> consent -> claim guest orders -> checkout link
-- -> export -> withdraw -> erase (202609250170).
--
-- Every assertion checks the row that landed, not merely that a call did not
-- raise (plpgsql-handlers-hide-resolution-errors): claiming is the one path
-- where a wrong answer hands one person's order history to another.

begin;

set local search_path = extensions, public;

select plan(31);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, phone, phone_confirmed_at, created_at, updated_at) values
 -- Ama: verified phone.
 ('71710000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,'233241171001',now(),now(),now()),
 -- Kofi: phone typed but never verified.
 ('71710000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,'233241171002',null,now(),now()),
 ('71710000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','seller@claim.test',null,null,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name) values
 ('71710000-0000-4000-8000-000000000101','71710000-0000-4000-8000-000000000003','GH','active',true,'Claim Seller');
insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status) values
 ('71710000-0000-4000-8000-000000000201','71710000-0000-4000-8000-000000000101','claim-shop','Claim Shop','GH','GHS','draft');

insert into public.customers (id, seller_account_id, name, email, phone, country) values
 ('71710000-0000-4000-8000-000000000301','71710000-0000-4000-8000-000000000101','Ama','ama@claim.test','+233241171001','GH'),
 ('71710000-0000-4000-8000-000000000302','71710000-0000-4000-8000-000000000101','Other','other@claim.test','+233209999999','GH');

-- o1: Ama, phone stored in the local shape an older path wrote.
-- o2: Ama, canonical shape.
-- o3: someone else.
-- o4: Ama, but 200 days old — outside the claim window.
-- o5: Ama, placed "just now" at checkout — linked by link_order_to_buyer.
-- o6: someone else, placed just now — a signed-in session must not pull it in.
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot, created_at) values
 ('71710000-0000-4000-8000-000000000601','71710000-0000-4000-8000-000000000201','71710000-0000-4000-8000-000000000101','71710000-0000-4000-8000-000000000301',
  'GHS',1000,0,1000,'cash_on_delivery','{}','{"name":"Ama","phone":"024 117 1001","country":"GH"}', now() - interval '3 days'),
 ('71710000-0000-4000-8000-000000000602','71710000-0000-4000-8000-000000000201','71710000-0000-4000-8000-000000000101','71710000-0000-4000-8000-000000000301',
  'GHS',1000,0,1000,'cash_on_delivery','{}','{"name":"Ama","phone":"+233241171001","country":"GH"}', now() - interval '2 days'),
 ('71710000-0000-4000-8000-000000000603','71710000-0000-4000-8000-000000000201','71710000-0000-4000-8000-000000000101','71710000-0000-4000-8000-000000000302',
  'GHS',1000,0,1000,'cash_on_delivery','{}','{"name":"Other","phone":"+233209999999","country":"GH"}', now() - interval '1 day'),
 ('71710000-0000-4000-8000-000000000604','71710000-0000-4000-8000-000000000201','71710000-0000-4000-8000-000000000101','71710000-0000-4000-8000-000000000301',
  'GHS',1000,0,1000,'cash_on_delivery','{}','{"name":"Ama","phone":"+233241171001","country":"GH"}', now() - interval '200 days'),
 ('71710000-0000-4000-8000-000000000606','71710000-0000-4000-8000-000000000201','71710000-0000-4000-8000-000000000101','71710000-0000-4000-8000-000000000302',
  'GHS',1000,0,1000,'cash_on_delivery','{}','{"name":"Other","phone":"+233209999999","country":"GH"}', now());

-- ── Normalisation matches what checkout stores ──────────────────────────────
select is(public.buyer_normalize_phone('0241234567', 'GH'), '+233241234567', 'local GH number gains the calling code');
select is(public.buyer_normalize_phone('233241234567', 'GH'), '+233241234567', 'an unprefixed international number is not double-prefixed');
select is(public.buyer_normalize_phone('0708091011', 'CI'), '+2250708091011', 'CI keeps its leading zero');

-- ── Bootstrap ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"71710000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.bootstrap_buyer_profile() ->> 'status', 'phone_unverified',
  'an unverified phone never becomes a buyer profile');
reset role;
select is((select count(*)::int from public.buyer_profiles where auth_user_id = '71710000-0000-4000-8000-000000000002'), 0,
  'and no row was written for it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"71710000-0000-4000-8000-000000000001","role":"authenticated"}';

create temp table boot as select public.bootstrap_buyer_profile() as r;
-- Read back under every role this test switches to.
grant select on boot to service_role, authenticated;
select is((select r ->> 'status' from boot), 'ok', 'a verified buyer bootstraps');
select is((select (r ->> 'created')::boolean from boot), true, 'the first bootstrap creates the profile');
select is((select r ->> 'phone' from boot), '+233241171001', 'the profile carries the verified phone in E.164');
select is((public.bootstrap_buyer_profile() ->> 'profileId'), (select r ->> 'profileId' from boot),
  'bootstrap is idempotent: the same profile comes back');

-- ── Consent gates every cross-shop link ─────────────────────────────────────
select is(public.claim_guest_orders() ->> 'status', 'consent_required', 'nothing is claimed without consent');
select throws_ok($$ select public.set_buyer_shared_profile_consent(true, '  ') $$, '22023', null,
  'consent must name the text version that was shown');
select is(public.set_buyer_shared_profile_consent(true, '2026-09') ->> 'status', 'ok', 'consent is recorded');

-- ── Claim ───────────────────────────────────────────────────────────────────
select is((public.claim_guest_orders() ->> 'claimed')::int, 2, 'both recent orders with the verified phone are claimed');
select is((public.claim_guest_orders() ->> 'claimed')::int, 0, 'claiming again is a no-op');
reset role;

select results_eq(
  $$ select id from public.orders where buyer_profile_id = (select (r ->> 'profileId')::uuid from boot) order by id $$,
  $$ values ('71710000-0000-4000-8000-000000000601'::uuid), ('71710000-0000-4000-8000-000000000602'::uuid) $$,
  'exactly the matching orders were linked — not another number''s, not one outside 180 days');
select is((select buyer_profile_id from public.customers where id = '71710000-0000-4000-8000-000000000301'),
  (select (r ->> 'profileId')::uuid from boot), 'the per-shop customer row with the same phone is linked');
select is((select buyer_profile_id from public.customers where id = '71710000-0000-4000-8000-000000000302'), null,
  'another customer is untouched');
select is((select count(*)::int from public.audit_events where action = 'buyer.guest_orders_claimed'
            and entity_id = (select (r ->> 'profileId')::uuid from boot)), 1,
  'one audit event for the claim, none for the no-op');

-- ── Link at checkout (service role only) ────────────────────────────────────
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot) values
 ('71710000-0000-4000-8000-000000000605','71710000-0000-4000-8000-000000000201','71710000-0000-4000-8000-000000000101','71710000-0000-4000-8000-000000000301',
  'GHS',1000,0,1000,'cash_on_delivery','{}','{"name":"Ama","phone":"+233241171001","country":"GH"}');

set local role service_role;
select is(public.link_order_to_buyer('71710000-0000-4000-8000-000000000605', (select (r ->> 'profileId')::uuid from boot)) ->> 'status',
  'linked', 'a just-placed order with the buyer''s phone is linked');
select is(public.link_order_to_buyer('71710000-0000-4000-8000-000000000605', (select (r ->> 'profileId')::uuid from boot)) ->> 'status',
  'already_linked', 'linking is idempotent');
select is(public.link_order_to_buyer('71710000-0000-4000-8000-000000000606', (select (r ->> 'profileId')::uuid from boot)) ->> 'status',
  'phone_mismatch', 'a signed-in session cannot pull in an order placed for another number');
select is(public.link_order_to_buyer('71710000-0000-4000-8000-000000000604', (select (r ->> 'profileId')::uuid from boot)) ->> 'status',
  'too_old', 'the checkout hook only links just-placed orders');
reset role;
select is((select buyer_profile_id from public.orders where id = '71710000-0000-4000-8000-000000000606'), null,
  'the mismatched order stayed a guest order');

-- ── Export ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"71710000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.buyer_addresses (buyer_profile_id, line1, city, country)
values ((select (r ->> 'profileId')::uuid from boot), '1 Export Lane', 'Accra', 'GH');
reset role;
insert into public.buyer_payment_methods (buyer_profile_id, provider, method, momo_network, msisdn_masked, provider_token_sealed)
values ((select (r ->> 'profileId')::uuid from boot), 'paystack', 'momo', 'mtn', '024****001', 'v1.c2VjcmV0.dGFn.U0VDUkVUVE9LRU4=');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71710000-0000-4000-8000-000000000001","role":"authenticated"}';

create temp table export_doc as select public.export_buyer_data() as d;
select is((select jsonb_array_length(d -> 'orders') from export_doc), 3, 'the export carries every linked order');
select ok((select d::text not like '%v1.c2VjcmV0%' from export_doc), 'the export never contains a sealed payment token');

-- ── Withdraw consent ────────────────────────────────────────────────────────
select is((public.set_buyer_shared_profile_consent(false) ->> 'ordersUnlinked')::int, 3,
  'withdrawing consent unlinks the cross-shop history');

-- ── Erasure ─────────────────────────────────────────────────────────────────
select is(public.request_buyer_deletion('testing') ->> 'status', 'ok', 'a buyer can erase their profile');
reset role;
select is((select count(*)::int from public.buyer_profiles
            where id = (select (r ->> 'profileId')::uuid from boot) and deleted_at is not null
              and phone_e164 is null and display_name is null), 1,
  'the profile is scrubbed and marked deleted');
select is((select count(*)::int from public.buyer_addresses where buyer_profile_id = (select (r ->> 'profileId')::uuid from boot))
        + (select count(*)::int from public.buyer_payment_methods where buyer_profile_id = (select (r ->> 'profileId')::uuid from boot)), 0,
  'saved addresses and payment methods are deleted');
select is((select count(*)::int from public.orders where id::text like '71710000-%'), 6,
  'the sellers keep their orders: erasure unlinks, it does not delete');

set local role authenticated;
set local request.jwt.claims = '{"sub":"71710000-0000-4000-8000-000000000001","role":"authenticated"}';
select isnt(public.bootstrap_buyer_profile() ->> 'profileId', (select r ->> 'profileId' from boot),
  'signing in again after erasure starts a fresh profile');
reset role;

select * from finish();
rollback;
