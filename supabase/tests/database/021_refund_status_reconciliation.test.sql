-- supabase/tests/database/021_refund_status_reconciliation.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000021101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','refund-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000021201','00000000-0000-0000-0000-000000021101','GH','active',true,'Refund Fixture Seller','refund-fixture@example.com','+233241234583');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('00000000-0000-0000-0000-000000021301','00000000-0000-0000-0000-000000021201','refund-fixture-shop','Refund Fixture Shop','Refund Fixture Shop Ltd','GH','GHS','published',now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('00000000-0000-0000-0000-000000021401','00000000-0000-0000-0000-000000021201','Refund Buyer','refund-buyer@example.com','+233241234584','GH');

insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor, delivery_minor, total_minor, payment_method, fulfillment_method_snapshot, buyer_snapshot, payment_status)
values ('00000000-0000-0000-0000-000000021501','00000000-0000-0000-0000-000000021301','00000000-0000-0000-0000-000000021201','00000000-0000-0000-0000-000000021401','GHS',10000,0,10000,'paystack','{}'::jsonb,'{}'::jsonb,'paid');

insert into public.payment_attempts (id, order_id, seller_account_id, reference, amount_minor, currency, status)
values ('00000000-0000-0000-0000-000000021601','00000000-0000-0000-0000-000000021501','00000000-0000-0000-0000-000000021201','refund-fixture-ref',10000,'GHS','paid');

insert into public.refunds (id, order_id, payment_attempt_id, seller_account_id, amount_minor, provider_refund_id, status)
values ('00000000-0000-0000-0000-000000021701','00000000-0000-0000-0000-000000021501','00000000-0000-0000-0000-000000021601','00000000-0000-0000-0000-000000021201',10000,'provider-refund-1','processing');

-- Webhook reports the refund actually processed: status flips to
-- 'completed' and the order's refund_status reflects full coverage.
select public.apply_paystack_refund_event('event-key-1','provider-refund-1','processed','{}'::jsonb);

select is(
  (select status from public.refunds where id = '00000000-0000-0000-0000-000000021701'),
  'completed',
  'refund status updates to completed on a processed webhook event'
);
select is(
  (select refund_status from public.orders where id = '00000000-0000-0000-0000-000000021501'),
  'completed',
  'order refund_status reflects the fully-refunded total'
);

-- A duplicate delivery of the same event is a safe no-op (idempotent via
-- provider_events' unique (provider,event_key)).
select is(
  (select public.apply_paystack_refund_event('event-key-1','provider-refund-1','processed','{}'::jsonb)),
  false,
  'a duplicate event_key is not reapplied'
);

-- An unknown provider_refund_id (never created via the refund route) is
-- rejected rather than silently creating orphaned state.
select is(
  (select public.apply_paystack_refund_event('event-key-2','not-a-real-refund-id','processed','{}'::jsonb)),
  false,
  'an event for an unknown refund is rejected'
);

select * from finish();
rollback;
