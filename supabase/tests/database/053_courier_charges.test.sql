-- A delivery SnapDuka books on its own courier account is paid for out of the
-- order's held settlement, never out of SnapDuka's pocket, and the books close.

begin;

set local search_path = extensions, public;

select plan(10);

update public.country_configs
   set platform_fee_bps = 700, delivery_margin_bps = 1000
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('53530000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'courier-charge@example.com', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, settlement_mode_override)
values ('53530000-0000-4000-8000-0000000000a1', '53530000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Courier Seller', 'courier-charge@example.com', 'ledger');
insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('53530000-0000-4000-8000-0000000000b1', '53530000-0000-4000-8000-0000000000a1',
        'courier-charge-shop', 'Courier Shop', 'Courier Shop Ltd', 'GH', 'GHS', 'published', now());
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('53530000-0000-4000-8000-0000000000c1', '53530000-0000-4000-8000-0000000000a1',
        'Kofi', 'kofi@example.com', '+233241110005', 'GH');
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency,
                           subtotal_minor, delivery_minor, total_minor, payment_method,
                           fulfillment_method_snapshot, buyer_snapshot)
values ('53530000-0000-4000-8000-0000000000d1', '53530000-0000-4000-8000-0000000000b1',
        '53530000-0000-4000-8000-0000000000a1', '53530000-0000-4000-8000-0000000000c1',
        'GHS', 10000, 0, 10000, 'paystack', '{}'::jsonb, '{}'::jsonb);
insert into public.payment_attempts (order_id, seller_account_id, reference, amount_minor, currency, status)
values ('53530000-0000-4000-8000-0000000000d1', '53530000-0000-4000-8000-0000000000a1',
        'courier-ref-1', 10000, 'GHS', 'pending');
select public.apply_paystack_success('courier-ref-1', 'evt:courier-ref-1',
  '{"data":{"status":"success","amount":10000,"currency":"GHS","fees":0}}'::jsonb);

insert into public.shipments (id, seller_account_id, order_id, provider, tracking_number, booked_via, provider_shipment_id)
values ('53530000-0000-4000-8000-0000000000e1', '53530000-0000-4000-8000-0000000000a1',
        '53530000-0000-4000-8000-0000000000d1', 'sandbox', 'TRK-1', 'adapter', 'bk-1');

select ok(public.courier_booking_billable('53530000-0000-4000-8000-0000000000d1', 2000),
  'a held ledger order can cover a GH₵20 delivery');
select ok(not public.courier_booking_billable('53530000-0000-4000-8000-0000000000d1', 999999),
  'but not more than is still held');

select is(public.charge_courier_booking('53530000-0000-4000-8000-0000000000e1', 2000), 2200::bigint,
  'cost 2000 plus the 10% margin is charged');
select is(public.charge_courier_booking('53530000-0000-4000-8000-0000000000e1', 2000), 2200::bigint,
  'charging twice is a no-op');
select is((select pending_minor from public.order_settlements where order_id = '53530000-0000-4000-8000-0000000000d1'),
  7100::bigint, 'the seller''s held share shrinks by the charge (9300 - 2200)');
select is((select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
            where kind = 'courier_payable' and currency = 'GHS'), 2000::bigint,
  'SnapDuka owes the courier its price');
select is((select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
            where kind = 'delivery_margin_revenue' and currency = 'GHS'), 200::bigint,
  'and keeps its margin');

update public.order_settlements set release_at = now() - interval '1 minute'
 where order_id = '53530000-0000-4000-8000-0000000000d1';
update public.orders set status = 'completed', fulfillment_status = 'fulfilled'
 where id = '53530000-0000-4000-8000-0000000000d1';
update public.order_settlements set release_at = now() - interval '1 minute'
 where order_id = '53530000-0000-4000-8000-0000000000d1';
select lives_ok($$select public.release_due_order_settlements()$$,
  'the reduced settlement still releases cleanly');

select lives_ok($$select public.settle_courier_payable('GHS', 2000, 'INV-1', null)$$,
  'paying the courier invoice clears the payable');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'every invariant holds');

select * from finish();
rollback;
