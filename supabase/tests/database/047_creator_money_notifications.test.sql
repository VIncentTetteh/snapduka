-- supabase/tests/database/047_creator_money_notifications.test.sql
--
-- The two creator events nobody presses a button for.
--
-- 202609060096 gave creators their first notifications — accepted partnership,
-- recorded payment — but both of those hang off a human action in the web app.
-- Earning a commission and a commission maturing happen on their own, in SQL: a
-- trigger on orders.payment_status and a nightly pg_cron release. A creator
-- posted a link and then heard nothing until they thought to open the portal.
--
-- Both paths swallow enqueue failures on purpose — a message must never roll
-- back a buyer's payment or stop money becoming payable — which means a broken
-- call is invisible in production. That is exactly why these assert the row is
-- there rather than that the call did not raise. Two real bugs were caught this
-- way: min() has no uuid form, and sum() over bigint returns numeric with no
-- implicit cast back, so the enqueue failed to resolve and the release kept
-- freeing commissions while telling nobody.
begin;

set local search_path = extensions, public;

select plan(10);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
 ('1cb00000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','seller@notify.test',now(),now()),
 ('1cb00000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','creator@notify.test',now(),now()),
 ('1cb00000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paused@notify.test',now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('2cb00000-0000-4000-8000-000000000001','1cb00000-0000-4000-8000-000000000001','GH','active',true,'Notify Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('3cb00000-0000-4000-8000-000000000001','2cb00000-0000-4000-8000-000000000001','notify-shop','Notify Shop','GH','GHS','published',now());

-- No contact_email on either, so SMS is the channel — the one that always
-- exists, since creators.contact_phone is NOT NULL and the email is optional.
insert into public.creators (id, auth_user_id, handle, display_name, contact_phone, country, status) values
 ('4cb00000-0000-4000-8000-000000000001','1cb00000-0000-4000-8000-000000000002','notify_creator','Notify Creator','+233201234533','GH','active'),
 ('4cb00000-0000-4000-8000-000000000002','1cb00000-0000-4000-8000-000000000003','gone_creator','Gone Creator','+233201234544','GH','suspended');

insert into public.creator_partnerships (id, seller_account_id, creator_id, status, rate_bps, hold_days, currency, accepted_at)
values ('5cb00000-0000-4000-8000-000000000001','2cb00000-0000-4000-8000-000000000001','4cb00000-0000-4000-8000-000000000001','active',1000,14,'GHS',now());

insert into public.campaign_links (id, seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
values ('6cb00000-0000-4000-8000-000000000001','2cb00000-0000-4000-8000-000000000001','3cb00000-0000-4000-8000-000000000001','Notify link','notifyl-o','other','/notify-shop','5cb00000-0000-4000-8000-000000000001');

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('7cb00000-0000-4000-8000-000000000001','2cb00000-0000-4000-8000-000000000001','Buyer','buyer@notify.test','+233209999533','GH');

-- Two orders at 10%: 5000 -> 500 and 8000 -> 800.
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency,
  subtotal_minor, discount_minor, delivery_minor, total_minor,
  payment_method, fulfillment_method_snapshot, buyer_snapshot, campaign_snapshot)
values
 ('8cb00000-0000-4000-8000-000000000001','3cb00000-0000-4000-8000-000000000001','2cb00000-0000-4000-8000-000000000001','7cb00000-0000-4000-8000-000000000001','GHS',5000,0,0,5000,'cash_on_delivery','{}'::jsonb,'{}'::jsonb,jsonb_build_object('id','6cb00000-0000-4000-8000-000000000001')),
 ('8cb00000-0000-4000-8000-000000000002','3cb00000-0000-4000-8000-000000000001','2cb00000-0000-4000-8000-000000000001','7cb00000-0000-4000-8000-000000000001','GHS',8000,0,0,8000,'cash_on_delivery','{}'::jsonb,'{}'::jsonb,jsonb_build_object('id','6cb00000-0000-4000-8000-000000000001'));

-- ── "You earned X" ─────────────────────────────────────────────────────────
update public.orders set payment_status = 'paid' where id = '8cb00000-0000-4000-8000-000000000001';

select is((select count(*)::int from public.notifications
            where template='creator_commission_earned' and payload->>'shopName'='Notify Shop'),
  1, 'accrual tells the creator they earned');

-- Minor units and a currency rather than a formatted string: formatting is
-- Intl.NumberFormat and SQL cannot reproduce it, so the worker does it and both
-- paths render identically.
select is((select payload->>'amountMinor' from public.notifications
            where template='creator_commission_earned' and payload->>'shopName'='Notify Shop'),
  '500', 'in minor units, so the worker formats it the way the app does');
select is((select payload->>'currency' from public.notifications
            where template='creator_commission_earned' and payload->>'shopName'='Notify Shop'),
  'GHS', 'with the currency beside it');
select is((select channel from public.notifications
            where template='creator_commission_earned' and payload->>'shopName'='Notify Shop'),
  'sms', 'SMS when the creator has no email, the channel that always exists');
select is((select recipient from public.notifications
            where template='creator_commission_earned' and payload->>'shopName'='Notify Shop'),
  '+233201234533', 'addressed to their phone');

-- The webhook/verify race replays this edge; the commission insert is already
-- idempotent and the message has to be too.
update public.orders set payment_status = 'pending' where id = '8cb00000-0000-4000-8000-000000000001';
update public.orders set payment_status = 'paid' where id = '8cb00000-0000-4000-8000-000000000001';

select is((select count(*)::int from public.notifications
            where template='creator_commission_earned' and payload->>'shopName'='Notify Shop'),
  1, 'and only once, however many times the order is re-marked paid');

-- ── "X is ready to be paid" ────────────────────────────────────────────────
update public.orders set payment_status = 'paid' where id = '8cb00000-0000-4000-8000-000000000002';
update public.creator_commissions set payable_at = now() - interval '1 day'
where creator_id = '4cb00000-0000-4000-8000-000000000001';

select is(public.release_due_creator_commissions(), 2,
  'the release still returns how many it freed');

-- A shop that sells steadily matures dozens in a night, and dozens of texts
-- saying the same thing is not a notification, it is a reason to block the
-- sender.
select is((select count(*)::int from public.notifications
            where template='creator_commission_payable' and payload->>'shopName'='Notify Shop'),
  1, 'one message for the whole batch, not one per commission');
select is((select payload->>'amountMinor' from public.notifications
            where template='creator_commission_payable' and payload->>'shopName'='Notify Shop'),
  '1300', 'carrying the total that just became payable');

select is(
  public.enqueue_creator_notification(
    '4cb00000-0000-4000-8000-000000000002','2cb00000-0000-4000-8000-000000000001',
    'creator_commission_earned','Notify Shop',100,'GHS','suspended-key'),
  false, 'a suspended creator is not messaged');

select * from finish();
rollback;
