-- supabase/tests/database/046_creator_carry_over.test.sql
--
-- A refund after payout is netted off the next payment, which is what the
-- partnership page has always promised and what nothing did.
--
-- Before 202609060097, record_creator_commission_payment summed amount_minor
-- over the selected commissions and never read creator_commission_adjustments,
-- so a seller who had already paid a commission on a since-refunded order kept
-- paying the full gross while owed_now stayed permanently depressed by the debt.
-- The two numbers on screen disagreed and neither moved.
--
-- The carry-over here is produced by the real reversal trigger rather than
-- inserted by hand, because the thing under test is the whole cycle: refund,
-- next payment, settled.
begin;

set local search_path = extensions, public;

select plan(11);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('1ca00000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','seller@carry.test',now(),now()),
  ('1ca00000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','creator@carry.test',now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('2ca00000-0000-4000-8000-000000000001','1ca00000-0000-4000-8000-000000000001','GH','active',true,'Carry Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('3ca00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000001','carry-shop','Carry Shop','GH','GHS','published',now());

insert into public.creators (id, auth_user_id, handle, display_name, contact_phone, country, status)
values ('4ca00000-0000-4000-8000-000000000001','1ca00000-0000-4000-8000-000000000002','carry_creator','Carry Creator','+233201234511','GH','active');

insert into public.creator_partnerships (id, seller_account_id, creator_id, status, rate_bps, hold_days, currency, accepted_at)
values ('5ca00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000001','4ca00000-0000-4000-8000-000000000001','active',1000,14,'GHS',now());

insert into public.campaign_links (id, seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
values ('6ca00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000001','3ca00000-0000-4000-8000-000000000001','Carry link','carryln-t','tiktok','/carry-shop','5ca00000-0000-4000-8000-000000000001');

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('7ca00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000001','Buyer','buyer@carry.test','+233209999511','GH');

-- Three orders at 10%: 5000 -> 500 (paid, then refunded), 8000 -> 800 and
-- 3000 -> 300 (the next payment).
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency,
  subtotal_minor, discount_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot, campaign_snapshot)
values
  ('8ca00000-0000-4000-8000-000000000001','3ca00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000001','7ca00000-0000-4000-8000-000000000001','GHS',5000,0,0,5000,'cash_on_delivery','{}'::jsonb,'{}'::jsonb,jsonb_build_object('id','6ca00000-0000-4000-8000-000000000001','token','carryln-t')),
  ('8ca00000-0000-4000-8000-000000000002','3ca00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000001','7ca00000-0000-4000-8000-000000000001','GHS',8000,0,0,8000,'cash_on_delivery','{}'::jsonb,'{}'::jsonb,jsonb_build_object('id','6ca00000-0000-4000-8000-000000000001','token','carryln-t')),
  ('8ca00000-0000-4000-8000-000000000003','3ca00000-0000-4000-8000-000000000001','2ca00000-0000-4000-8000-000000000001','7ca00000-0000-4000-8000-000000000001','GHS',3000,0,0,3000,'cash_on_delivery','{}'::jsonb,'{}'::jsonb,jsonb_build_object('id','6ca00000-0000-4000-8000-000000000001','token','carryln-t'));

update public.orders set payment_status = 'paid'
where id in ('8ca00000-0000-4000-8000-000000000001','8ca00000-0000-4000-8000-000000000002','8ca00000-0000-4000-8000-000000000003');

update public.creator_commissions set payable_at = now() - interval '1 day'
where creator_id = '4ca00000-0000-4000-8000-000000000001';
select is(public.release_due_creator_commissions(), 3, 'all three commissions mature');

-- ── The first payment: no carry-over yet, so nothing is netted ─────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ca00000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (public.record_creator_commission_payment(
    '4ca00000-0000-4000-8000-000000000001',
    array(select id from public.creator_commissions where order_id = '8ca00000-0000-4000-8000-000000000001'),
    'mobile_money')->>'amountMinor')::bigint,
  500::bigint,
  'with nothing outstanding the payment is the plain sum'
);

reset role;

-- ── The refund lands after the money was sent ──────────────────────────────
update public.orders set refund_status = 'completed' where id = '8ca00000-0000-4000-8000-000000000001';

select is(
  (select delta_minor from public.creator_commission_adjustments
    where creator_id = '4ca00000-0000-4000-8000-000000000001'),
  -500::bigint,
  'the refund books a 500 carry-over'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"1ca00000-0000-4000-8000-000000000001","role":"authenticated"}';

-- 1100 payable remains (800 + 300) against a 500 debt.
select is(
  (select owed_now_minor from public.creator_commission_balances('4ca00000-0000-4000-8000-000000000001') where currency = 'GHS'),
  600::bigint,
  'the detail page shows the debt already taken off'
);
select is(
  (select owed_now_minor from public.seller_creator_commission_totals()
    where creator_id = '4ca00000-0000-4000-8000-000000000001' and currency = 'GHS'),
  600::bigint,
  'and the list page agrees, which it could not before it read adjustments'
);

-- ── The next payment nets it off ───────────────────────────────────────────
create temp table carry_paid as
select public.record_creator_commission_payment(
  '4ca00000-0000-4000-8000-000000000001',
  array(select id from public.creator_commissions
         where order_id in ('8ca00000-0000-4000-8000-000000000002','8ca00000-0000-4000-8000-000000000003')),
  'mobile_money') as r;

select is((select (r->>'grossMinor')::bigint from carry_paid), 1100::bigint,
  'the commissions selected are worth 1100');
select is((select (r->>'adjustmentMinor')::bigint from carry_paid), -500::bigint,
  'the carry-over is reported so the seller can be told why the figures differ');
select is((select (r->>'amountMinor')::bigint from carry_paid), 600::bigint,
  'but only 600 is recorded as paid');
select is(
  (select amount_minor from public.creator_commission_payments
    where id = (select (r->>'paymentId')::uuid from carry_paid)),
  600::bigint,
  'and the ledger row holds the netted figure, not the gross');

select is(
  (select settled_by_payment_id from public.creator_commission_adjustments
    where creator_id = '4ca00000-0000-4000-8000-000000000001'),
  (select (r->>'paymentId')::uuid from carry_paid),
  'the adjustment is marked consumed by that payment, so it cannot be netted twice');

select is(
  (select owed_now_minor from public.creator_commission_balances('4ca00000-0000-4000-8000-000000000001') where currency = 'GHS'),
  0::bigint,
  'nothing is left owing');

select * from finish();
rollback;
