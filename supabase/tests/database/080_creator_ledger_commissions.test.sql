-- Creator commissions paid through the ledger (202609250200-0202).
--
-- Every path here moves real money between a seller and a creator inside
-- SnapDuka's pooled account, so each one also asserts the books still close and
-- check_ledger_invariants() is clean — including the creator-specific check
-- that each creator's creator_pending equals what their commissions say is held.
--
-- Pinned: accrual carves the commission out of the seller's settlement; the
-- flag-off, cash-on-delivery and subaccount paths are byte-for-byte the old
-- record-only flow; release waits for BOTH the order settlement and the
-- commission hold; refunds reverse pro rata back to the seller (including into
-- arrears after a creator withdrew); a ledger commission can never be marked
-- paid by hand; and the path cannot change once money has moved.

begin;

set local search_path = extensions, public;

select plan(67);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
update public.country_configs
   set platform_fee_bps = 700, payout_hold_days = 3
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('80800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-a@cl.test', now(), now()),
  ('80800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-b@cl.test', now(), now()),
  ('80800000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'creator-a@cl.test', now(), now()),
  ('80800000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'creator-b@cl.test', now(), now());

-- Seller A: on ledger settlement, inside the creator_ledger_payouts rollout.
-- Seller B: on ledger settlement, flag OFF — must keep the record-only flow.
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, settlement_mode_override)
values
  ('80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-000000000001', 'GH', 'active', true, 'Seller A', 'ledger'),
  ('80800000-0000-4000-8000-0000000000a2', '80800000-0000-4000-8000-000000000002', 'GH', 'active', true, 'Seller B', 'ledger');

insert into public.feature_flags (key, seller_account_id, enabled)
values ('creator_ledger_payouts', '80800000-0000-4000-8000-0000000000a1', true);

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values
  ('80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000a1', 'cl-shop-a', 'Shop A', 'GH', 'GHS', 'published', now()),
  ('80800000-0000-4000-8000-0000000000b2', '80800000-0000-4000-8000-0000000000a2', 'cl-shop-b', 'Shop B', 'GH', 'GHS', 'published', now());

insert into public.creators (id, auth_user_id, handle, display_name, contact_phone, country)
values
  ('80800000-0000-4000-8000-0000000000c1', '80800000-0000-4000-8000-000000000003', 'cl_creator_a', 'Creator A', '+233201110001', 'GH'),
  ('80800000-0000-4000-8000-0000000000c2', '80800000-0000-4000-8000-000000000004', 'cl_creator_b', 'Creator B', '+233201110002', 'GH');

-- A-C1 at 10%, B-C1 at 10%, A-C2 at 50% (for the fallback case).
insert into public.creator_partnerships (id, seller_account_id, creator_id, status, rate_bps, hold_days, currency, accepted_at)
values
  ('80800000-0000-4000-8000-0000000000e1', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000c1', 'active', 1000, 14, 'GHS', now()),
  ('80800000-0000-4000-8000-0000000000e2', '80800000-0000-4000-8000-0000000000a2', '80800000-0000-4000-8000-0000000000c1', 'active', 1000, 14, 'GHS', now()),
  ('80800000-0000-4000-8000-0000000000e3', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000c2', 'active', 5000, 14, 'GHS', now());

insert into public.campaign_links (id, seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
values
  ('80800000-0000-4000-8000-0000000000f1', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', 'C1 at A', 'cl-link-a', 'tiktok', '/cl-shop-a', '80800000-0000-4000-8000-0000000000e1'),
  ('80800000-0000-4000-8000-0000000000f2', '80800000-0000-4000-8000-0000000000a2', '80800000-0000-4000-8000-0000000000b2', 'C1 at B', 'cl-link-b', 'tiktok', '/cl-shop-b', '80800000-0000-4000-8000-0000000000e2'),
  ('80800000-0000-4000-8000-0000000000f3', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', 'C2 at A', 'cl-link-c', 'tiktok', '/cl-shop-a', '80800000-0000-4000-8000-0000000000e3');

insert into public.customers (id, seller_account_id, name, email, phone, country)
values
  ('80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000a1', 'Buyer A', 'buyer-a@cl.test', '+233209990001', 'GH'),
  ('80800000-0000-4000-8000-0000000000d2', '80800000-0000-4000-8000-0000000000a2', 'Buyer B', 'buyer-b@cl.test', '+233209990002', 'GH');

-- GH₵1,000 goods, no delivery: platform fee 7000, seller gross 93000,
-- a 10% commission of 10000.
--   o1  A, paystack, via C1            -> ledger
--   o2  A, cash on delivery, via C1    -> manual (offline money never reaches us)
--   o3  B, paystack, via C1 (flag off) -> manual
--   o4  A, paystack, via C1            -> ledger, then refunded
--   o5  A, paystack, no link           -> hosts a hand-built commission too big to carve
--   o6  A, paystack, via C1            -> commission hold shorter than the order's
--   o7  A, paystack, via C1            -> cancelled after payment
--   o8  A, paystack, via C1            -> full card chargeback lost while held
create temporary table t_orders (key text primary key, id uuid, seller uuid, shop uuid, customer uuid, link uuid, method text);
insert into t_orders values
  ('o1', '80800000-0000-4000-8000-000000000101', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000f1', 'paystack'),
  ('o2', '80800000-0000-4000-8000-000000000102', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000f1', 'cash_on_delivery'),
  ('o3', '80800000-0000-4000-8000-000000000103', '80800000-0000-4000-8000-0000000000a2', '80800000-0000-4000-8000-0000000000b2', '80800000-0000-4000-8000-0000000000d2', '80800000-0000-4000-8000-0000000000f2', 'paystack'),
  ('o4', '80800000-0000-4000-8000-000000000104', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000f1', 'paystack'),
  ('o5', '80800000-0000-4000-8000-000000000105', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000f3', 'paystack'),
  ('o6', '80800000-0000-4000-8000-000000000106', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000f1', 'paystack'),
  ('o7', '80800000-0000-4000-8000-000000000107', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000f1', 'paystack'),
  ('o8', '80800000-0000-4000-8000-000000000108', '80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000b1', '80800000-0000-4000-8000-0000000000d1', '80800000-0000-4000-8000-0000000000f1', 'paystack');

insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency,
  subtotal_minor, discount_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot, campaign_snapshot)
select t.id, t.shop, t.seller, t.customer, 'GHS', 100000, 0, 0, 100000,
       t.method, '{}'::jsonb, '{"name":"Buyer"}'::jsonb,
       case when t.key = 'o5' then null else jsonb_build_object('id', t.link) end
  from t_orders t;

-- Pays through the real Paystack success path: the order is marked paid (which
-- fires accrual) and THEN capture runs — the ordering the design depends on.
create or replace function pg_temp.pay(p_key text) returns boolean language plpgsql as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = (select id from t_orders where key = p_key);
  insert into public.payment_attempts (order_id, seller_account_id, reference, amount_minor, currency, status)
  values (o.id, o.seller_account_id, 'cl-ref-' || p_key, o.total_minor, o.currency, 'pending');
  return public.apply_paystack_success('cl-ref-' || p_key, 'cl-evt:' || p_key,
    jsonb_build_object('data', jsonb_build_object('status', 'success', 'amount', o.total_minor,
                                                  'currency', o.currency, 'fees', 0)));
end $$;

-- Refunds through the real Paystack refund webhook path.
create or replace function pg_temp.refund(p_key text, p_amount bigint) returns boolean language plpgsql as $$
declare o public.orders%rowtype; v_attempt uuid;
begin
  select * into o from public.orders where id = (select id from t_orders where key = p_key);
  select id into v_attempt from public.payment_attempts where order_id = o.id;
  insert into public.refunds (order_id, payment_attempt_id, seller_account_id, amount_minor, provider_refund_id, status)
  values (o.id, v_attempt, o.seller_account_id, p_amount, 'cl-rf-' || p_key || '-' || p_amount, 'processing');
  return public.apply_paystack_refund_event('cl-rf-evt:' || p_key || '-' || p_amount,
    'cl-rf-' || p_key || '-' || p_amount, 'processed', '{}'::jsonb);
end $$;

create or replace function pg_temp.bal(p_kind text, p_owner uuid) returns bigint language sql as $$
  select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
   where kind::text = p_kind and currency = 'GHS'
     and (owner_seller_account_id = p_owner or owner_creator_id = p_owner);
$$;

create or replace function pg_temp.commission(p_key text) returns public.creator_commissions language sql as $$
  select * from public.creator_commissions where order_id = (select id from t_orders where key = p_key);
$$;

create or replace function pg_temp.books_close() returns boolean language sql as $$
  select coalesce(sum(amount_minor), 0) = 0 from public.ledger_entries;
$$;

-- ---------------------------------------------------------------------------
-- Accrual
-- ---------------------------------------------------------------------------
select ok(pg_temp.pay('o1'), 'o1 is paid online');

select is((pg_temp.commission('o1')).settlement, 'ledger',
  'a flag-on seller''s online order earns a ledger-settled commission');
select is((pg_temp.commission('o1')).amount_minor, 10000::bigint, 'the commission is 10% of the goods');
select is(pg_temp.bal('creator_pending', '80800000-0000-4000-8000-0000000000c1'), 10000::bigint,
  'the commission sits in the creator''s pending wallet');
select is(pg_temp.bal('seller_pending', '80800000-0000-4000-8000-0000000000a1'), 83000::bigint,
  'and came out of the seller''s pending share (93000 - 10000)');
select is(
  (select pending_minor from public.order_settlements where order_id = '80800000-0000-4000-8000-000000000101'),
  83000::bigint, 'the settlement''s own position agrees with the ledger');
select is(
  (select creator_commission_minor from public.order_settlements where order_id = '80800000-0000-4000-8000-000000000101'),
  10000::bigint, 'and records why it is below the seller''s gross');
select is((pg_temp.commission('o1')).ledger_pending_minor, 10000::bigint,
  'the commission row records what it holds');
select ok(pg_temp.books_close(), 'the books close after accrual');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'invariants are clean after accrual');

-- Replays: the webhook and the verify redirect both arrive.
select is(
  public.capture_order_settlement('80800000-0000-4000-8000-000000000101', null, 'cl-ref-o1', 0),
  null, 'capturing o1 again is a no-op');
select is(public.post_creator_commission_accrual((pg_temp.commission('o1')).id), null,
  'accruing the same commission again is a no-op');
select is(
  (select count(*)::int from public.ledger_transactions where kind = 'creator_accrual'
    and order_id = '80800000-0000-4000-8000-000000000101'),
  1, 'exactly one accrual was posted');

-- The path is fixed once money has moved.
select throws_ok(
  $$update public.creator_commissions set settlement = 'manual'
     where order_id = '80800000-0000-4000-8000-000000000101'$$,
  '55000', null, 'a ledger commission cannot be switched to manual once in flight');

-- ---------------------------------------------------------------------------
-- The unchanged paths
-- ---------------------------------------------------------------------------
update public.orders set payment_status = 'paid'
 where id = '80800000-0000-4000-8000-000000000102';
select is((pg_temp.commission('o2')).settlement, 'manual', 'a cash-on-delivery commission stays manual');
select is(
  (select count(*)::int from public.ledger_transactions where order_id = '80800000-0000-4000-8000-000000000102'),
  0, 'and posts nothing to the ledger');

select ok(pg_temp.pay('o3'), 'o3 is paid online');
select is((pg_temp.commission('o3')).settlement, 'manual',
  'a flag-off seller''s commission stays manual even on the ledger');
select is(
  (select pending_minor from public.order_settlements where order_id = '80800000-0000-4000-8000-000000000103'),
  93000::bigint, 'and the seller keeps their whole share, as before');
select is(
  (select count(*)::int from public.ledger_transactions where order_id = '80800000-0000-4000-8000-000000000103'
     and kind like 'creator%'),
  0, 'no creator money moves for it');

-- A ledger commission that cannot fit in the seller's share falls back to
-- manual before any money moves, instead of failing the buyer's payment. No
-- real order reaches this (the fee cap and the 50% rate cap keep a commission
-- inside the seller's share), so the commission is built by hand against o5's
-- settlement: 50% of a 200000 basis is more than o5's 93000.
select ok(pg_temp.pay('o5'), 'o5 is paid online');
insert into public.creator_commissions (
  seller_account_id, creator_id, partnership_id, order_id, currency, basis_minor, rate_bps,
  amount_minor, hold_days, order_reference, order_placed_at, shop_display_name, payable_at, settlement)
values ('80800000-0000-4000-8000-0000000000a1', '80800000-0000-4000-8000-0000000000c2',
        '80800000-0000-4000-8000-0000000000e3', '80800000-0000-4000-8000-000000000105', 'GHS',
        200000, 5000, 100000, 14, 'CL-O5', now(), 'Shop A', now() + interval '14 days', 'ledger');
select is(public.post_creator_commission_accrual((pg_temp.commission('o5')).id), null,
  'a commission larger than the seller''s share is not carved out');
select is((pg_temp.commission('o5')).settlement, 'manual', 'it falls back to manual');
select is(
  (select count(*)::int from public.domain_events where event_type = 'creator.ledger_fallback'
     and aggregate_id = (pg_temp.commission('o5')).id),
  1, 'and operators hear about it');
select is(
  (select pending_minor from public.order_settlements where order_id = '80800000-0000-4000-8000-000000000105'),
  93000::bigint, 'the seller''s share is untouched');

-- ---------------------------------------------------------------------------
-- Release: both the order settlement and the commission hold
-- ---------------------------------------------------------------------------
update public.orders set fulfillment_status = 'fulfilled'
 where id = '80800000-0000-4000-8000-000000000101';
update public.order_settlements set release_at = now() - interval '1 day'
 where order_id = '80800000-0000-4000-8000-000000000101';

select is(public.release_due_creator_commissions(), 0,
  'nothing releases to the creator before the order settlement has');

select ok(public.release_due_order_settlements() >= 1, 'the order settlement releases');
select is(pg_temp.bal('seller_available', '80800000-0000-4000-8000-0000000000a1'), 83000::bigint,
  'the seller receives their share net of the commission');
select is((pg_temp.commission('o1')).status::text, 'pending',
  'the creator''s share waits out its own 14-day hold');
select is(pg_temp.bal('creator_available', '80800000-0000-4000-8000-0000000000c1'), 0::bigint,
  'nothing is withdrawable by the creator yet');

update public.creator_commissions set payable_at = now() - interval '1 minute'
 where order_id in ('80800000-0000-4000-8000-000000000101', '80800000-0000-4000-8000-000000000102');

select is(public.release_due_creator_commissions(), 2,
  'the nightly run releases one ledger commission and makes one manual commission payable');
select is(pg_temp.bal('creator_available', '80800000-0000-4000-8000-0000000000c1'), 10000::bigint,
  'the ledger commission is now withdrawable');
select is(pg_temp.bal('creator_pending', '80800000-0000-4000-8000-0000000000c1'), 0::bigint,
  'and has left pending');
select ok((pg_temp.commission('o1')).status = 'paid' and (pg_temp.commission('o1')).payment_id is null,
  'it is paid by SnapDuka, with no seller-recorded payment behind it');
select is((pg_temp.commission('o2')).status::text, 'payable',
  'the cash-on-delivery commission follows the old flow to payable');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'invariants are clean after release');

-- A seller cannot also pay a ledger commission by hand.
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"80800000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;
select throws_ok(
  $$select public.record_creator_commission_payment('80800000-0000-4000-8000-0000000000c1',
      array[(select id from public.creator_commissions where order_id = '80800000-0000-4000-8000-000000000101')],
      'mobile_money')$$,
  'P0001', null, 'a ledger commission can never be recorded as paid by the seller');
select lives_ok(
  $$select public.record_creator_commission_payment('80800000-0000-4000-8000-0000000000c1',
      array[(select id from public.creator_commissions where order_id = '80800000-0000-4000-8000-000000000102')],
      'mobile_money')$$,
  'a manual commission is still recorded exactly as before');
reset role;

-- ---------------------------------------------------------------------------
-- Release in the same pass, when the commission hold ran out first
-- ---------------------------------------------------------------------------
select ok(pg_temp.pay('o6'), 'o6 is paid online');
update public.creator_commissions set payable_at = now() - interval '1 minute'
 where order_id = '80800000-0000-4000-8000-000000000106';
select is(public.release_due_creator_commissions(), 0,
  'an elapsed commission hold alone releases nothing');
update public.orders set fulfillment_status = 'fulfilled'
 where id = '80800000-0000-4000-8000-000000000106';
update public.order_settlements set release_at = now() - interval '1 day'
 where order_id = '80800000-0000-4000-8000-000000000106';
select ok(public.release_due_order_settlements() >= 1, 'o6''s settlement releases');
select is((pg_temp.commission('o6')).status::text, 'paid',
  'the creator''s share is released in the same pass as the seller''s');
select is(pg_temp.bal('creator_available', '80800000-0000-4000-8000-0000000000c1'), 20000::bigint,
  'both released commissions are withdrawable');

-- ---------------------------------------------------------------------------
-- Cancellation after payment
-- ---------------------------------------------------------------------------
select ok(pg_temp.pay('o7'), 'o7 is paid online');
update public.orders set status = 'cancelled' where id = '80800000-0000-4000-8000-000000000107';
select is((pg_temp.commission('o7')).status::text, 'reversed', 'cancelling reverses the commission');
select is(
  (select pending_minor from public.order_settlements where order_id = '80800000-0000-4000-8000-000000000107'),
  93000::bigint, 'and the whole share goes back to the seller''s pending');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'invariants are clean after a cancellation');

-- ---------------------------------------------------------------------------
-- A card chargeback lost while the money was held
-- ---------------------------------------------------------------------------
-- The dispute caps the seller's share at what is left in seller_pending (83000,
-- the creator's 10000 already carved out), so SnapDuka absorbs the creator's
-- cut; the creator's reversed share must go to SnapDuka, not to the seller.
select ok(pg_temp.pay('o8'), 'o8 is paid online');
create temporary table t_before as
select pg_temp.bal('seller_available', '80800000-0000-4000-8000-0000000000a1') as seller_available,
       (select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
         where kind = 'platform_revenue' and currency = 'GHS') as platform_revenue;
select is(
  public.apply_paystack_dispute_event('cl-dsp-create', 'charge.dispute.create',
    jsonb_build_object('data', jsonb_build_object('id', 'cl-dsp-1', 'refund_amount', 100000,
      'transaction', jsonb_build_object('reference', 'cl-ref-o8')))),
  'applied', 'a chargeback opens on o8');
select is(
  public.apply_paystack_dispute_event('cl-dsp-resolve', 'charge.dispute.resolve',
    jsonb_build_object('data', jsonb_build_object('id', 'cl-dsp-1', 'resolution', 'merchant-accepted',
      'refund_amount', 100000, 'transaction', jsonb_build_object('reference', 'cl-ref-o8')))),
  'applied', 'and is lost');
select is((pg_temp.commission('o8')).status::text, 'reversed', 'the creator''s commission on it is reversed');
select is(
  pg_temp.bal('seller_available', '80800000-0000-4000-8000-0000000000a1') - (select seller_available from t_before),
  0::bigint, 'the seller is not handed the creator''s share back');
-- Measured after capture: the chargeback takes 17000 from platform_revenue
-- (SnapDuka's own 7000 fee, given back as on any chargeback, plus the
-- creator's 10000 cut) and the creator's reversal returns 10000. SnapDuka ends
-- down exactly its fee — the same as a chargeback on an order with no creator.
select is(
  (select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
    where kind = 'platform_revenue' and currency = 'GHS') - (select platform_revenue from t_before),
  -7000::bigint, 'SnapDuka recovers the creator''s share it absorbed, and loses only its own fee');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'invariants are clean after a lost chargeback');

-- ---------------------------------------------------------------------------
-- Refund while held: pro rata, back to the seller's pending share
-- ---------------------------------------------------------------------------
select ok(pg_temp.pay('o4'), 'o4 is paid online');
select ok(pg_temp.refund('o4', 50000), 'half of o4 is refunded');

select is((pg_temp.commission('o4')).amount_minor, 5000::bigint,
  'the commission halves with the order');
select is(pg_temp.bal('creator_pending', '80800000-0000-4000-8000-0000000000c1'), 5000::bigint,
  'the creator''s pending wallet gives back its half');
-- Seller pending for o4 alone: 93000 - 10000 accrual + 5000 returned - 46500
-- refund share (50000 less its 7% fee share of 3500) = 41500.
select is(
  (select pending_minor from public.order_settlements where order_id = '80800000-0000-4000-8000-000000000104'),
  41500::bigint, 'the seller bears their share of the refund, and only theirs');
select ok(pg_temp.books_close(), 'the books close after a partial refund');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'invariants are clean after a partial refund');

-- ---------------------------------------------------------------------------
-- Refund after the creator withdrew: arrears, like a seller
-- ---------------------------------------------------------------------------
-- The creator's 20000 from o1 and o6 is available; take 16000 of it out as a
-- settled withdrawal so a full refund of o1 drives creator_available below zero.
select public.post_ledger_transaction('test_withdraw', 'cl-test-withdraw', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'creator_available', 'creator_id', '80800000-0000-4000-8000-0000000000c1', 'amount_minor', 16000),
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -16000)));

select ok(pg_temp.refund('o1', 100000), 'o1 is refunded in full after release');
select is((pg_temp.commission('o1')).status::text, 'reversed', 'the released commission is reversed');
select is(pg_temp.bal('creator_available', '80800000-0000-4000-8000-0000000000c1'), -6000::bigint,
  'the creator now owes what they had already withdrawn');
select is(
  (select status from public.ledger_accounts where kind = 'creator_available'
     and owner_creator_id = '80800000-0000-4000-8000-0000000000c1' and currency = 'GHS'),
  'in_arrears', 'and their wallet is flagged in arrears');
select ok(pg_temp.books_close(), 'the books close after a refund into arrears');
select is((select count(*)::int from public.check_ledger_invariants()), 0,
  'invariants are clean after a refund into arrears');

select * from finish();
rollback;
