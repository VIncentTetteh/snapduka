-- Fixtures for scripts/check_models.py --verify. Runs inside the checker's
-- transaction, which is always rolled back. Money moves through the real
-- paths (apply_paystack_success, confirm_delivery, the dispute trigger), so the
-- ledger lines the take-rate mart reads are the ones production would write.
--
-- One GH seller, four GH₵100.00 orders, all this week:
--   o1  Protect, paid, delivered and confirmed with the buyer's code
--   o2  Protect, paid, dispatched, buyer opens an item_not_received case
--   o3  unprotected, paid, then a processor chargeback
--   o4  unpaid (never counts)
-- Two WhatsApp conversations: one from o3's buyer (typed locally at checkout,
-- E.164 on WhatsApp), one from a buyer who never orders.
-- Snap-to-list: four successful drafts, one failure, one accepted.

update public.country_configs
   set protect_enabled = true, platform_fee_bps = 700, payout_hold_days = 3,
       protect_fee_bps = 150, protect_fee_min_minor = 100, protect_fee_cap_minor = 2000,
       protect_max_order_minor = 200000, protect_float_cap_minor = 5000000
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('09400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'wh-mart-seller@example.com', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, contact_phone, settlement_mode_override)
values ('09400000-0000-4000-8000-0000000000a1', '09400000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Mart Seller', 'wh-mart-seller@example.com', '+233241119401', 'ledger');
insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('09400000-0000-4000-8000-0000000000b1', '09400000-0000-4000-8000-0000000000a1',
        'wh-mart-shop', 'Mart Shop', 'Mart Shop Ltd', 'GH', 'GHS', 'published', now());
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('09400000-0000-4000-8000-0000000000c1', '09400000-0000-4000-8000-0000000000a1',
        'Abena Buyer', 'abena@example.com', '+233241119402', 'GH');

insert into public.orders (id, shop_id, seller_account_id, customer_id, currency,
                           subtotal_minor, delivery_minor, total_minor, payment_method,
                           fulfillment_method_snapshot, buyer_snapshot)
select v.id::uuid, '09400000-0000-4000-8000-0000000000b1', '09400000-0000-4000-8000-0000000000a1',
       '09400000-0000-4000-8000-0000000000c1', 'GHS', 10000, 0, 10000, 'paystack', '{}'::jsonb,
       jsonb_build_object('name', 'Abena', 'phone', v.phone, 'country', 'GH')
  from (values ('09400000-0000-4000-8000-0000000000d1', '+233241119411'),
               ('09400000-0000-4000-8000-0000000000d2', '+233241119412'),
               ('09400000-0000-4000-8000-0000000000d3', '024 111 9413'),
               ('09400000-0000-4000-8000-0000000000d4', '+233241119414')) v(id, phone);

select public.set_order_protection(id, tracking_token, true)
  from public.orders
 where id in ('09400000-0000-4000-8000-0000000000d1', '09400000-0000-4000-8000-0000000000d2');

create or replace function pg_temp.pay(p_order uuid, p_ref text) returns boolean language plpgsql as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order;
  insert into public.payment_attempts (order_id, seller_account_id, reference, amount_minor, currency, status)
  values (o.id, o.seller_account_id, p_ref, o.total_minor, o.currency, 'pending');
  return public.apply_paystack_success(p_ref, 'evt:' || p_ref,
    jsonb_build_object('data', jsonb_build_object('status', 'success', 'amount', o.total_minor,
                                                  'currency', o.currency, 'fees', 0)));
end $$;

select pg_temp.pay('09400000-0000-4000-8000-0000000000d1', 'wh-mart-1');
select pg_temp.pay('09400000-0000-4000-8000-0000000000d2', 'wh-mart-2');
select pg_temp.pay('09400000-0000-4000-8000-0000000000d3', 'wh-mart-3');

-- o1: dispatched, confirmed with the buyer's code.
update public.orders set fulfillment_status = 'dispatched' where id = '09400000-0000-4000-8000-0000000000d1';
select public.confirm_delivery('09400000-0000-4000-8000-0000000000d1',
  (select payload->>'code' from public.domain_events
    where aggregate_id = '09400000-0000-4000-8000-0000000000d1' and event_type = 'protect.code_issued'
    order by id desc limit 1),
  'buyer_code');

-- o2: dispatched, then the buyer reports it never arrived.
update public.orders set fulfillment_status = 'dispatched' where id = '09400000-0000-4000-8000-0000000000d2';
insert into public.support_cases (order_id, seller_account_id, reason, description, status)
values ('09400000-0000-4000-8000-0000000000d2', '09400000-0000-4000-8000-0000000000a1',
        'item_not_received', 'Never came.', 'seller_response_due');

-- o3: a processor chargeback. Only its existence is counted here; the money
-- path belongs to 202609250109 and its own tests.
insert into public.payment_disputes (provider, provider_dispute_id, order_id, seller_account_id, currency,
                                     amount_minor, seller_share_minor, reserved_from, status)
values ('paystack', 'wh-mart-cb-1', '09400000-0000-4000-8000-0000000000d3',
        '09400000-0000-4000-8000-0000000000a1', 'GHS', 10000, 0, 'pending', 'open');

insert into public.wa_conversations (buyer_phone, seller_account_id)
values ('+233241119413', '09400000-0000-4000-8000-0000000000a1'),
       ('+233241119499', '09400000-0000-4000-8000-0000000000a1');

insert into public.ai_runs (seller_account_id, purpose, model, outcome)
select '09400000-0000-4000-8000-0000000000a1', 'listing_draft', 'claude-sonnet-5',
       case when n <= 4 then 'ok' else 'error' end
  from generate_series(1, 5) n;
select public.record_server_analytics_event('listing_ai_accepted', '09400000-0000-4000-8000-0000000000a1',
  '09400000-0000-4000-8000-0000000000aa');
