-- supabase/tests/database/026_creator_commission_lifecycle.test.sql
--
-- The money path. Every branch here is one a creator would dispute if it were
-- wrong, and most of them only occur days after the order — so they are pinned
-- rather than trusted.
begin;

set local search_path = extensions, public;

select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures: a seller with a shop, a creator, an accepted partnership at 12.5%,
-- and a creator campaign link.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('11110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller@lifecycle.test', now(), now()),
  ('11110000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'creator@lifecycle.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('22220000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', 'GH', 'active', true, 'Lifecycle Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('33330000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001', 'lifecycle-shop', 'Lifecycle Shop', 'GH', 'GHS', 'published', now());

insert into public.creators (id, auth_user_id, handle, display_name, contact_phone, country)
values ('44440000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000002', 'lifecycle_creator', 'Lifecycle Creator', '+233201234567', 'GH');

insert into public.creator_partnerships (id, seller_account_id, creator_id, status, rate_bps, hold_days, currency, accepted_at)
values ('55550000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-000000000001', 'active', 1250, 14, 'GHS', now());

insert into public.campaign_links (id, seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
values ('66660000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-000000000001', 'Creator link', 'lifecyc-t', 'tiktok', '/lifecycle-shop', '55550000-0000-4000-8000-000000000001');

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('77770000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001', 'Buyer', 'buyer@lifecycle.test', '+233209999999', 'GH');

-- Subtotal 20000, discount 2000, delivery 2500 -> total 20500.
-- Commissionable basis is 18000 (delivery excluded), at 12.5% = 2250.
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency,
  subtotal_minor, discount_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot, campaign_snapshot)
values (
  '88880000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-000000000001',
  '22220000-0000-4000-8000-000000000001', '77770000-0000-4000-8000-000000000001', 'GHS',
  20000, 2000, 2500, 20500, 'paystack', '{}'::jsonb, '{}'::jsonb,
  jsonb_build_object('id', '66660000-0000-4000-8000-000000000001', 'token', 'lifecyc-t'));

-- ---------------------------------------------------------------------------
-- Accrual
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  0,
  'an unpaid order accrues nothing'
);

update public.orders set payment_status = 'paid' where id = '88880000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  1,
  'paying the order accrues exactly one commission'
);

-- Delivery excluded is the assertion most likely to regress unnoticed.
select is(
  (select basis_minor from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  18000::bigint,
  'basis is subtotal minus discount, with delivery excluded'
);

select is(
  (select amount_minor from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  2250::bigint,
  'commission is 12.5% of the basis'
);

select is(
  (select status::text from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  'pending',
  'a fresh commission starts inside the hold window'
);

-- The webhook and the verify endpoint both mark an order paid; the second must
-- not double-accrue.
update public.orders set payment_status = 'paid' where id = '88880000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  1,
  'marking paid again does not accrue a second commission'
);

-- ---------------------------------------------------------------------------
-- Hold release
-- ---------------------------------------------------------------------------
select is(
  public.release_due_creator_commissions(),
  0,
  'nothing is released while still inside the hold window'
);

update public.creator_commissions set payable_at = now() - interval '1 day'
where order_id = '88880000-0000-4000-8000-000000000001';

select is(public.release_due_creator_commissions(), 1, 'a matured commission is released');

select is(
  (select status::text from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  'payable',
  'the released commission is payable'
);

-- ---------------------------------------------------------------------------
-- Settlement authorization
-- ---------------------------------------------------------------------------
-- The ledger must be unwritable directly, or a seller could mark their own
-- commissions paid without paying.
select is(
  has_table_privilege('authenticated', 'public.creator_commissions', 'UPDATE'),
  false,
  'authenticated cannot update the commission ledger directly'
);
select is(
  has_table_privilege('authenticated', 'public.creator_commissions', 'INSERT'),
  false,
  'authenticated cannot insert into the commission ledger directly'
);

-- ---------------------------------------------------------------------------
-- Reversal after payment: history is preserved, the debt is booked separately
-- ---------------------------------------------------------------------------
insert into public.creator_commission_payments
  (id, seller_account_id, creator_id, amount_minor, currency, method, marked_by)
values ('99990000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001',
        '44440000-0000-4000-8000-000000000001', 2250, 'GHS', 'mobile_money',
        '11110000-0000-4000-8000-000000000001');

update public.creator_commissions
set status = 'paid', paid_at = now(), payment_id = '99990000-0000-4000-8000-000000000001'
where order_id = '88880000-0000-4000-8000-000000000001';

update public.orders set refund_status = 'completed' where id = '88880000-0000-4000-8000-000000000001';

select is(
  (select status::text from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001'),
  'paid',
  'a refund after payout does not rewrite the settled commission'
);

select is(
  (select delta_minor from public.creator_commission_adjustments
    where commission_id = (select id from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000001')),
  -2250::bigint,
  'the refund books a negative adjustment against future earnings instead'
);

-- ---------------------------------------------------------------------------
-- Reversal before payment: the commission itself is reversed
-- ---------------------------------------------------------------------------
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency,
  subtotal_minor, discount_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot, campaign_snapshot)
values (
  '88880000-0000-4000-8000-000000000002', '33330000-0000-4000-8000-000000000001',
  '22220000-0000-4000-8000-000000000001', '77770000-0000-4000-8000-000000000001', 'GHS',
  10000, 0, 0, 10000, 'cash_on_delivery', '{}'::jsonb, '{}'::jsonb,
  jsonb_build_object('id', '66660000-0000-4000-8000-000000000001', 'token', 'lifecyc-t'));

-- Cash on delivery never touches the Paystack webhook, which is exactly why
-- accrual hangs off payment_status rather than the checkout RPC.
update public.orders set payment_status = 'paid' where id = '88880000-0000-4000-8000-000000000002';

select is(
  (select amount_minor from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000002'),
  1250::bigint,
  'an offline payment accrues commission too'
);

update public.orders set status = 'cancelled' where id = '88880000-0000-4000-8000-000000000002';

select is(
  (select status::text from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000002'),
  'reversed',
  'cancelling before payout reverses the commission outright'
);

select is(
  (select amount_minor from public.creator_commissions where order_id = '88880000-0000-4000-8000-000000000002'),
  0::bigint,
  'a reversed commission is worth nothing'
);

select * from finish();
rollback;
