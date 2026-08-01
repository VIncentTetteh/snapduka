-- The money lifecycle end to end: capture -> hold -> release -> withdraw ->
-- settle, plus every way it can go wrong.
--
-- 029 pins the ledger's structural invariants (balance, immutability, zero-sum).
-- This file pins the BEHAVIOUR of the functions that will move real money the
-- moment a market is switched to settlement_mode = 'ledger'. Until now they had
-- been exercised only by hand against production, and that evidence was deleted
-- with the probe data.
--
-- request_seller_payout is the one that matters most: it is the only path by
-- which money leaves, and its correctness rests on a row lock that no amount of
-- reading can verify.

begin;

set local search_path = extensions, public;

select plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures: a verified GH seller with a shop, an active payout destination
-- past its cool-off, and a paid online order.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('77770000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'payout@lifecycle.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('88880000-0000-4000-8000-000000000001', '77770000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Payout Seller');

insert into public.seller_verifications (seller_account_id, state, provider, provider_reference, checked_at)
values ('88880000-0000-4000-8000-000000000001', 'verified', 'operator', 'test-ref', now());

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('99990000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-000000000001',
        'payout-shop', 'Payout Shop', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('bbbb0000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-000000000001',
        'Buyer', 'buyer@lifecycle.test', '+233201234567', 'GH');

insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values (
  'aaaa0000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001',
  'GHS', 'confirmed', 'paid', 'unconfirmed',
  'paystack', 10000, 0, 10000, '{"name":"Buyer"}'::jsonb, '{"type":"delivery"}'::jsonb);

-- An offline order, to prove it never credits a wallet.
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values (
  'aaaa0000-0000-4000-8000-000000000002', '99990000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001',
  'GHS', 'confirmed', 'paid', 'unconfirmed',
  'cash_on_delivery', 5000, 0, 5000, '{"name":"Buyer"}'::jsonb, '{"type":"pickup"}'::jsonb);

update public.country_configs set settlement_mode = 'ledger', payouts_enabled = true
where country = 'GH';

-- ---------------------------------------------------------------------------
-- Capture
-- ---------------------------------------------------------------------------
select isnt(
  public.capture_order_settlement('aaaa0000-0000-4000-8000-000000000001', null, 'ref-1', 195),
  null, 'an online order captures a settlement');

select is(
  (select platform_fee_minor from public.order_settlements
    where order_id = 'aaaa0000-0000-4000-8000-000000000001'),
  700::bigint, 'the platform fee is 7% of gross');

select is(
  (select seller_gross_minor from public.order_settlements
    where order_id = 'aaaa0000-0000-4000-8000-000000000001'),
  9300::bigint, 'the seller share is the remainder, so the two reconstruct gross');

-- Fee and hold are snapshotted so a later config change cannot rewrite history.
select is(
  (select platform_fee_bps from public.order_settlements
    where order_id = 'aaaa0000-0000-4000-8000-000000000001'),
  700, 'the fee rate is snapshotted on the settlement');

-- The guard that stops the webhook and the verify route double-crediting.
select is(
  public.capture_order_settlement('aaaa0000-0000-4000-8000-000000000001', null, 'ref-1', 195),
  null, 'capturing the same order twice is a no-op');

select is(
  (select count(*)::int from public.order_settlements
    where order_id = 'aaaa0000-0000-4000-8000-000000000001'),
  1, 'the replay created no second settlement');

-- Offline money never reaches SnapDuka, so crediting a wallet for it would
-- invent a debt we do not owe.
select is(
  public.capture_order_settlement('aaaa0000-0000-4000-8000-000000000002', null, 'ref-2', 0),
  null, 'an offline order captures nothing');

select is(
  (select balance_minor from public.ledger_accounts
    where kind = 'seller_pending' and currency = 'GHS'
      and owner_seller_account_id = '88880000-0000-4000-8000-000000000001'),
  9300::bigint, 'the wallet holds only the online share, pending');

-- ---------------------------------------------------------------------------
-- Hold release
-- ---------------------------------------------------------------------------
select is(public.release_due_order_settlements(), 0,
  'nothing releases while release_at is null (order not yet delivered)');

-- Delivery stamps fulfilled_at by trigger and starts the hold clock.
update public.orders set fulfillment_status = 'fulfilled'
 where id = 'aaaa0000-0000-4000-8000-000000000001';

select isnt(
  (select fulfilled_at from public.orders where id = 'aaaa0000-0000-4000-8000-000000000001'),
  null, 'delivery stamps fulfilled_at');

select isnt(
  (select release_at from public.order_settlements
    where order_id = 'aaaa0000-0000-4000-8000-000000000001'),
  null, 'delivery starts the hold clock');

select is(public.release_due_order_settlements(), 0,
  'nothing releases before the hold has elapsed');

-- Back-date the hold.
update public.order_settlements set release_at = now() - interval '1 day'
 where order_id = 'aaaa0000-0000-4000-8000-000000000001';

-- An order that soured during the hold must never become withdrawable. This
-- re-check at release time is the entire reason a hold exists.
update public.orders set refund_status = 'partial'
 where id = 'aaaa0000-0000-4000-8000-000000000001';
select is(public.release_due_order_settlements(), 0,
  'a refunded order does not release');

update public.orders set refund_status = 'none', dispute_status = 'opened'
 where id = 'aaaa0000-0000-4000-8000-000000000001';
select is(public.release_due_order_settlements(), 0,
  'a disputed order does not release');

update public.orders set dispute_status = 'none'
 where id = 'aaaa0000-0000-4000-8000-000000000001';
select is(public.release_due_order_settlements(), 1,
  'a clean order releases once the hold elapses');

select is(public.release_due_order_settlements(), 0,
  'a released settlement does not release twice');

select is(
  (select balance_minor from public.ledger_accounts
    where kind = 'seller_available' and currency = 'GHS'
      and owner_seller_account_id = '88880000-0000-4000-8000-000000000001'),
  9300::bigint, 'the released share is now withdrawable');

-- ---------------------------------------------------------------------------
-- Withdrawal. Behaviour, not just privileges.
-- ---------------------------------------------------------------------------
insert into public.payout_destinations (
  seller_account_id, currency, type, bank_code, bank_name, account_last4,
  recipient_code, status, activated_at, request_fingerprint)
values ('88880000-0000-4000-8000-000000000001', 'GHS', 'mobile_money', 'MTN', 'MTN',
        '4987', 'RCP_test', 'active', now() - interval '48 hours', 'fp-test');

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"77770000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;

select throws_ok(
  $$select public.request_seller_payout(100)$$,
  '55000', null, 'a withdrawal below the minimum is rejected');

select throws_ok(
  $$select public.request_seller_payout(999999)$$,
  '55000', null, 'a withdrawal above the available balance is rejected');

select lives_ok(
  $$select public.request_seller_payout(5000)$$,
  'a valid withdrawal is accepted');

-- One open payout at a time: the simplest correct answer to the double-spend.
select throws_ok(
  $$select public.request_seller_payout(1000)$$,
  '55000', null, 'a second open withdrawal is refused');

reset role;

-- The reservation must land in the SAME transaction as the request, so the
-- displayed balance is honest the instant the seller asks.
select is(
  (select balance_minor from public.ledger_accounts
    where kind = 'seller_available' and currency = 'GHS'
      and owner_seller_account_id = '88880000-0000-4000-8000-000000000001'),
  4300::bigint, 'the requested amount left the available balance immediately');

select is(
  (select balance_minor from public.ledger_accounts
    where kind = 'seller_payout_reserved' and currency = 'GHS'
      and owner_seller_account_id = '88880000-0000-4000-8000-000000000001'),
  5000::bigint, 'and is held in reserve, not lost');

-- ---------------------------------------------------------------------------
-- Settlement. Only the provider webhook may declare that money moved.
-- ---------------------------------------------------------------------------
select is(
  public.apply_paystack_transfer_event(
    'transfer.success:test-1',
    (select reference from public.payout_requests limit 1),
    '123', 'success', '{"data":{"fee":0}}'::jsonb),
  true, 'a transfer.success settles the payout');

select is(
  (select status from public.payout_requests limit 1),
  'paid', 'the payout is marked paid by the webhook, not by an operator');

select is(
  (select balance_minor from public.ledger_accounts
    where kind = 'seller_payout_reserved' and currency = 'GHS'
      and owner_seller_account_id = '88880000-0000-4000-8000-000000000001'),
  0::bigint, 'the reservation clears once the transfer settles');

-- seller_wallet_balance is security definer and takes a seller id as an
-- argument, so trusting it would let any signed-in seller read any other
-- seller's balance. It re-authorises by hand; this pins that.
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"77770000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;

select lives_ok(
  $$select public.seller_wallet_balance('88880000-0000-4000-8000-000000000001', 'GHS')$$,
  'a seller can read their own wallet');

select throws_ok(
  $$select public.seller_wallet_balance('00000000-0000-0000-0000-0000000000ff', 'GHS')$$,
  '42501', null, 'a seller cannot read another seller''s wallet');

reset role;

select * from finish();
rollback;
