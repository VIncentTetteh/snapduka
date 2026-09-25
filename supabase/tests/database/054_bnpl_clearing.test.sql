-- BNPL money never touches Paystack's clearing account: the partner pays
-- SnapDuka's bank, so its capture and its refunds live in partner_clearing and
-- the nightly Paystack reconciliation is not thrown into drift.

begin;

set local search_path = extensions, public;

select plan(6);

update public.country_configs set platform_fee_bps = 700 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('54540000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'bnpl-seller@example.com', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, settlement_mode_override)
values ('54540000-0000-4000-8000-0000000000a1', '54540000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'BNPL Seller', 'bnpl-seller@example.com', 'ledger');
insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('54540000-0000-4000-8000-0000000000b1', '54540000-0000-4000-8000-0000000000a1',
        'bnpl-shop', 'BNPL Shop', 'BNPL Shop Ltd', 'GH', 'GHS', 'published', now());
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('54540000-0000-4000-8000-0000000000c1', '54540000-0000-4000-8000-0000000000a1',
        'Esi', 'esi@example.com', '+233241110009', 'GH');
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency,
                           subtotal_minor, delivery_minor, total_minor, payment_method,
                           fulfillment_method_snapshot, buyer_snapshot)
values ('54540000-0000-4000-8000-0000000000d1', '54540000-0000-4000-8000-0000000000b1',
        '54540000-0000-4000-8000-0000000000a1', '54540000-0000-4000-8000-0000000000c1',
        'GHS', 20000, 0, 20000, 'paystack', '{}'::jsonb, '{}'::jsonb);
insert into public.payment_attempts (id, order_id, seller_account_id, reference, amount_minor, currency, status, provider, route_reason)
values ('54540000-0000-4000-8000-0000000000e1', '54540000-0000-4000-8000-0000000000d1',
        '54540000-0000-4000-8000-0000000000a1', 'bnpl-ref-1', 20000, 'GHS', 'pending', 'bnpl', 'bnpl:sandbox');

create or replace function pg_temp.bal(p_kind text) returns bigint language sql as $$
  select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
   where kind::text = p_kind and currency = 'GHS' and owner_seller_account_id is null;
$$;

select ok(public.apply_paystack_success('bnpl-ref-1', 'bnpl:sandbox:evt-1',
  '{"data":{"status":"success","amount":20000,"currency":"GHS","fees":0}}'::jsonb),
  'a BNPL approval captures through the one capture path');
select is(pg_temp.bal('partner_clearing'), 20000::bigint, 'the capture is owed by the partner');
select is(pg_temp.bal('processor_clearing'), 0::bigint, 'and never lands in Paystack clearing');

insert into public.refunds (id, order_id, payment_attempt_id, seller_account_id, amount_minor, status)
values ('54540000-0000-4000-8000-0000000000f1', '54540000-0000-4000-8000-0000000000d1',
        '54540000-0000-4000-8000-0000000000e1', '54540000-0000-4000-8000-0000000000a1', 5000, 'completed');
select isnt(public.apply_refund_to_ledger('54540000-0000-4000-8000-0000000000f1'), null,
  'a BNPL refund is clawed back');
select is(pg_temp.bal('partner_clearing'), 15000::bigint, 'from partner clearing, where the capture was booked');

select is((select count(*)::int from public.check_ledger_invariants()), 0, 'every invariant holds');

select * from finish();
rollback;
