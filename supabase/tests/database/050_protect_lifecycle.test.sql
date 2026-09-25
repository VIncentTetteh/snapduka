-- SnapDuka Protect end to end: the money never releases on a seller's claim,
-- only on delivery confirmation, a timeout, or an operator decision — and every
-- path leaves the ledger balanced.

begin;

set local search_path = extensions, public;

select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
update public.country_configs
   set protect_enabled = true, platform_fee_bps = 700, payout_hold_days = 3,
       protect_fee_bps = 150, protect_fee_min_minor = 100, protect_fee_cap_minor = 2000,
       protect_max_order_minor = 200000, protect_float_cap_minor = 5000000
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('50500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'protect-seller@example.com', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, contact_phone, settlement_mode_override)
values ('50500000-0000-4000-8000-0000000000a1', '50500000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Protect Seller', 'protect-seller@example.com', '+233241110001', 'ledger');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('50500000-0000-4000-8000-0000000000b1', '50500000-0000-4000-8000-0000000000a1',
        'protect-shop', 'Protect Shop', 'Protect Shop Ltd', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('50500000-0000-4000-8000-0000000000c1', '50500000-0000-4000-8000-0000000000a1',
        'Ama Buyer', 'ama@example.com', '+233241110002', 'GH');

-- Three orders: happy path, disputed, timed out. GH₵100.00 each, unpaid.
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency,
                           subtotal_minor, delivery_minor, total_minor, payment_method,
                           fulfillment_method_snapshot, buyer_snapshot)
select id::uuid, '50500000-0000-4000-8000-0000000000b1', '50500000-0000-4000-8000-0000000000a1',
       '50500000-0000-4000-8000-0000000000c1', 'GHS', 10000, 0, 10000, 'paystack',
       '{}'::jsonb, '{"name":"Ama","phone":"+233241110002"}'::jsonb
  from (values ('50500000-0000-4000-8000-0000000000d1'),
               ('50500000-0000-4000-8000-0000000000d2'),
               ('50500000-0000-4000-8000-0000000000d3')) v(id);

create temporary table t_ids as
select id, tracking_token from public.orders where seller_account_id = '50500000-0000-4000-8000-0000000000a1';

-- Pays an order through the real Paystack success path.
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

create or replace function pg_temp.balance(p_kind text) returns bigint language sql as $$
  select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
   where kind::text = p_kind and currency = 'GHS'
     and (owner_seller_account_id = '50500000-0000-4000-8000-0000000000a1'
          or (owner_seller_account_id is null and p_kind not like 'seller%'));
$$;

create or replace function pg_temp.latest_code(p_order uuid) returns text language sql as $$
  select payload->>'code' from public.domain_events
   where aggregate_id = p_order and event_type = 'protect.code_issued' order by id desc limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Opting in
-- ---------------------------------------------------------------------------
select is(
  public.set_order_protection('50500000-0000-4000-8000-0000000000d1',
    (select tracking_token from t_ids where id = '50500000-0000-4000-8000-0000000000d1'), true),
  '{"protectionMode":"protect","protectFeeMinor":150,"totalMinor":10150}'::jsonb,
  'opting in adds a 1.5% buyer fee to the total');

select throws_ok(
  $$select public.set_order_protection('50500000-0000-4000-8000-0000000000d1', gen_random_uuid(), true)$$,
  'P0002', 'Order not found.', 'the tracking token is required');

select is(
  (public.set_order_protection('50500000-0000-4000-8000-0000000000d1',
    (select tracking_token from t_ids where id = '50500000-0000-4000-8000-0000000000d1'), false))->>'totalMinor',
  '10000', 'opting out restores the original total');

select lives_ok($$
  select public.set_order_protection(id, tracking_token, true) from t_ids
$$, 'all three orders opt in');

-- ---------------------------------------------------------------------------
-- Capture holds the money
-- ---------------------------------------------------------------------------
select ok(pg_temp.pay('50500000-0000-4000-8000-0000000000d1', 'prot-1'), 'order 1 is paid');

select throws_ok(
  $$select public.set_order_protection(id, tracking_token, false) from t_ids
     where id = '50500000-0000-4000-8000-0000000000d1'$$,
  '55000', null, 'Protect cannot be changed once payment has started');

select is((select state::text from public.order_protections where order_id = '50500000-0000-4000-8000-0000000000d1'),
  'held', 'capture opens the protection as held');
select is((select release_at from public.order_settlements where order_id = '50500000-0000-4000-8000-0000000000d1'),
  null, 'the settlement hold has not started');
select is((select protect_fee_minor from public.order_settlements where order_id = '50500000-0000-4000-8000-0000000000d1'),
  150::bigint, 'the settlement records the Protect fee');
select is(pg_temp.balance('seller_pending'), 9300::bigint,
  'seller is owed goods minus the 7% platform fee, not the Protect fee');
select is(pg_temp.balance('protect_fee_revenue'), 150::bigint, 'the Protect fee is SnapDuka revenue');

-- ---------------------------------------------------------------------------
-- A seller's claim is not delivery
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.orders set status = 'completed' where id = '50500000-0000-4000-8000-0000000000d1'$$,
  '55000', null, 'a seller cannot complete a held Protect order');
select throws_ok(
  $$update public.orders set fulfillment_status = 'fulfilled' where id = '50500000-0000-4000-8000-0000000000d1'$$,
  '55000', null, 'nor mark it fulfilled');
select throws_ok(
  $$update public.orders set protect_fee_minor = 0, total_minor = 10000 where id = '50500000-0000-4000-8000-0000000000d1'$$,
  '55000', null, 'nor change its Protect terms after payment');

-- ---------------------------------------------------------------------------
-- Dispatch issues the code; the code confirms delivery
-- ---------------------------------------------------------------------------
update public.orders set fulfillment_status = 'dispatched' where id = '50500000-0000-4000-8000-0000000000d1';

select is((select state::text from public.order_protections where order_id = '50500000-0000-4000-8000-0000000000d1'),
  'in_transit', 'dispatch puts the order in transit');
select ok(pg_temp.latest_code('50500000-0000-4000-8000-0000000000d1') ~ '^[0-9]{6}$',
  'a six-digit code is queued for the buyer');
select ok((select delivery_code_hash from public.order_protections where order_id = '50500000-0000-4000-8000-0000000000d1')
  <> pg_temp.latest_code('50500000-0000-4000-8000-0000000000d1'), 'only a hash is stored');

select is(public.confirm_delivery('50500000-0000-4000-8000-0000000000d1',
            lpad(((pg_temp.latest_code('50500000-0000-4000-8000-0000000000d1')::int + 1) % 1000000)::text, 6, '0'),
            'rider_code'),
  'invalid_code', 'a wrong code is refused');
select is(public.confirm_delivery('50500000-0000-4000-8000-0000000000d1', null, 'rider_code'),
  'invalid_code', 'a missing code is refused');

select is(public.confirm_delivery('50500000-0000-4000-8000-0000000000d1',
            pg_temp.latest_code('50500000-0000-4000-8000-0000000000d1'), 'rider_code'),
  'confirmed', 'the right code confirms delivery');
select is((select row(state::text, confirmation_method) from public.order_protections
            where order_id = '50500000-0000-4000-8000-0000000000d1')::text,
  '(releasable,rider_code)', 'the protection is releasable');
select is((select row(status::text, fulfillment_status::text) from public.orders
            where id = '50500000-0000-4000-8000-0000000000d1')::text,
  '(completed,fulfilled)', 'the order completes');
select ok((select release_at between now() + interval '23 hours' and now() + interval '25 hours'
             from public.order_settlements where order_id = '50500000-0000-4000-8000-0000000000d1'),
  'release waits for the 24h inspection window');
select is(public.confirm_delivery('50500000-0000-4000-8000-0000000000d1', '000000', 'rider_code'),
  'already_confirmed', 'confirming twice is harmless');

select is(public.release_due_order_settlements(), 0, 'nothing releases during inspection');
update public.order_settlements set release_at = now() - interval '1 minute'
 where order_id = '50500000-0000-4000-8000-0000000000d1';
select is(public.release_due_order_settlements(), 1, 'after inspection the seller is paid');
select is((select state::text from public.order_protections where order_id = '50500000-0000-4000-8000-0000000000d1'),
  'released', 'the protection is closed');
select is(pg_temp.balance('seller_available'), 9300::bigint, 'the seller can withdraw 9300');

-- ---------------------------------------------------------------------------
-- Brute force
-- ---------------------------------------------------------------------------
select ok(pg_temp.pay('50500000-0000-4000-8000-0000000000d3', 'prot-3'), 'order 3 is paid');
update public.orders set fulfillment_status = 'dispatched' where id = '50500000-0000-4000-8000-0000000000d3';
select is(
  (select array_agg(public.confirm_delivery('50500000-0000-4000-8000-0000000000d3', 'x' || g, 'rider_code'))
     from generate_series(1, 5) g)::text,
  '{invalid_code,invalid_code,invalid_code,invalid_code,invalid_code}', 'five wrong codes');
select is(public.confirm_delivery('50500000-0000-4000-8000-0000000000d3',
            pg_temp.latest_code('50500000-0000-4000-8000-0000000000d3'), 'rider_code'),
  'locked', 'then even the right code is locked out for 30 minutes');

-- ---------------------------------------------------------------------------
-- Timeout
-- ---------------------------------------------------------------------------
select ok(public.record_courier_delivery('50500000-0000-4000-8000-0000000000d3'),
  'a courier delivery report is recorded as evidence');
select is((select state::text from public.order_protections where order_id = '50500000-0000-4000-8000-0000000000d3'),
  'in_transit', 'but does not release anything by itself');
update public.order_protections set auto_release_at = now() - interval '1 minute'
 where order_id = '50500000-0000-4000-8000-0000000000d3';
select is(public.protect_sweep(50)->>'autoConfirmed', '1', 'the sweep confirms a timed-out delivery');
select is((select confirmation_method from public.order_protections where order_id = '50500000-0000-4000-8000-0000000000d3'),
  'auto', 'recorded as automatic');

-- ---------------------------------------------------------------------------
-- Dispute freezes; operator refund closes it
-- ---------------------------------------------------------------------------
select ok(pg_temp.pay('50500000-0000-4000-8000-0000000000d2', 'prot-2'), 'order 2 is paid');
update public.orders set fulfillment_status = 'dispatched' where id = '50500000-0000-4000-8000-0000000000d2';
insert into public.support_cases (order_id, seller_account_id, reason, description, status)
values ('50500000-0000-4000-8000-0000000000d2', '50500000-0000-4000-8000-0000000000a1',
        'item_not_received', 'Rider never came.', 'seller_response_due');
select is((select row(p.state::text, s.frozen_reason) from public.order_protections p
             join public.order_settlements s using (order_id)
            where order_id = '50500000-0000-4000-8000-0000000000d2')::text,
  '(disputed,protect_dispute)', 'a buyer case freezes the held money');
update public.order_settlements set release_at = now() - interval '1 day'
 where order_id = '50500000-0000-4000-8000-0000000000d2';
select lives_ok($$select public.release_due_order_settlements()$$, 'the release worker runs');
select is((select status from public.order_settlements where order_id = '50500000-0000-4000-8000-0000000000d2'),
  'pending', 'a frozen settlement never releases, even past its release date');
select is(public.resolve_protect_dispute('50500000-0000-4000-8000-0000000000d2', 'refund',
            'Courier confirmed no delivery.', '50500000-0000-4000-8000-000000000001'),
  'resolved', 'an operator resolves for the buyer');
select ok(exists(select 1 from public.domain_events
                  where aggregate_id = '50500000-0000-4000-8000-0000000000d2'
                    and event_type = 'protect.refund_requested'),
  'which asks the refund path to return the money');

-- ---------------------------------------------------------------------------
-- Card chargeback on the released order
-- ---------------------------------------------------------------------------
select is(public.apply_paystack_dispute_event('dispute:create:1', 'charge.dispute.create',
  '{"data":{"id":"dp_1","refund_amount":10150,"status":"awaiting-merchant-feedback","transaction":{"reference":"prot-1","amount":10150}}}'),
  'applied', 'a chargeback on a released order is applied');
select is(pg_temp.balance('seller_dispute_reserve'), 9300::bigint,
  'the seller''s share is moved into the reserve');
select is(public.apply_paystack_dispute_event('dispute:resolve:1', 'charge.dispute.resolve',
  '{"data":{"id":"dp_1","resolution":"merchant-accepted","transaction":{"reference":"prot-1","amount":10150}}}'),
  'applied', 'a lost chargeback is applied');
select is(pg_temp.balance('seller_dispute_reserve'), 0::bigint, 'the reserve is spent on the chargeback');

-- ---------------------------------------------------------------------------
-- Write-off, and the books still close
-- ---------------------------------------------------------------------------
select throws_ok($$select public.write_off_seller_debt('50500000-0000-4000-8000-0000000000a1', 'GHS', 100,
                     'test', null, 'wo-0')$$,
  '55000', null, 'nothing to write off while the seller owes nothing');

select is((select count(*)::int from public.check_ledger_invariants()), 0, 'every invariant still holds');

select * from finish();
rollback;
