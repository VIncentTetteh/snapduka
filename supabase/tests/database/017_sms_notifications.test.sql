begin;

set local search_path = extensions, public;

select plan(5);

select has_column('public', 'notification_preferences', 'order_sms', 'notification_preferences has order_sms');
select col_default_is('public', 'notification_preferences', 'order_sms', 'false', 'order_sms defaults to false');

-- Fixture-seeding convention (auth.users + seller_accounts + shops +
-- customers + orders with fixed 00000000-0000-0000-0000-000000017xxx ids)
-- matches 004_catalog_rls.test.sql / 016_product_cost_tracking.test.sql.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000017101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sms-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000017201','00000000-0000-0000-0000-000000017101','GH','active',true,'SMS Fixture Seller','sms-fixture@example.com','+233241234581');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('00000000-0000-0000-0000-000000017301','00000000-0000-0000-0000-000000017201','sms-fixture-shop','SMS Fixture Shop','SMS Fixture Shop Ltd','GH','GHS','published',now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('00000000-0000-0000-0000-000000017401','00000000-0000-0000-0000-000000017201','SMS Fixture Buyer','sms-buyer@example.com','+233209876543','GH');

insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, subtotal_minor,
  delivery_minor, total_minor, payment_method, fulfillment_method_snapshot, buyer_snapshot
)
values (
  '00000000-0000-0000-0000-000000017501','00000000-0000-0000-0000-000000017301',
  '00000000-0000-0000-0000-000000017201','00000000-0000-0000-0000-000000017401',
  'GHS',10000,0,10000,'cash_on_delivery','{}'::jsonb,
  jsonb_build_object('email','sms-buyer@example.com','phone','+233209876543','marketingConsent',true)
);

-- Seller has NOT opted into SMS yet — enqueue must not create an sms row.
select public.enqueue_order_notification('00000000-0000-0000-0000-000000017501','placed');
select is(
  (select count(*)::int from public.notifications
    where order_id = '00000000-0000-0000-0000-000000017501' and channel = 'sms'),
  0,
  'no sms notification is enqueued when the seller has not opted in'
);

-- Opt the seller in, then re-run for a second event — an sms row should
-- now appear, addressed to the consenting buyer's phone.
insert into public.notification_preferences (seller_account_id, order_sms)
values ('00000000-0000-0000-0000-000000017201', true);

select public.enqueue_order_notification('00000000-0000-0000-0000-000000017501','shipped');
select is(
  (select recipient from public.notifications
    where order_id = '00000000-0000-0000-0000-000000017501' and channel = 'sms'
    order by created_at desc limit 1),
  '+233209876543',
  'sms notification is enqueued to the buyer''s phone once the seller opts in'
);

-- The 'sms' channel value itself must be accepted by the channel check
-- constraint (proves the constraint was actually widened, not just that
-- the trigger function inserts it).
select lives_ok(
  $$ insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
     values ('00000000-0000-0000-0000-000000017501','00000000-0000-0000-0000-000000017201','sms','+233200000000','order_update','{}'::jsonb) $$,
  'notifications_channel_check accepts the sms channel'
);

select * from finish();
rollback;
