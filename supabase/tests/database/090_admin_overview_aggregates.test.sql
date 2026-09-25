-- Admin overview, seller detail and creator dispute aggregates (202609250240):
-- correct past 1,000 rows, never mixing currencies, and callable by the
-- service role only.

begin;

set local search_path = extensions, public;

select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures. Orders are dated in 2100 so the "since" aggregates see only these
-- rows, whatever else the shared local database holds.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('09000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'agg-seller@example.com', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, contact_phone)
values ('09000000-0000-4000-8000-0000000000a1', '09000000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Agg Seller', 'agg-seller@example.com', '+233241119001');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('09000000-0000-4000-8000-0000000000b1', '09000000-0000-4000-8000-0000000000a1',
        'agg-shop', 'Agg Shop', 'Agg Shop Ltd', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('09000000-0000-4000-8000-0000000000c1', '09000000-0000-4000-8000-0000000000a1',
        'Kofi Buyer', 'kofi@example.com', '+233241119002', 'GH');

-- 1,500 paid GHS orders of GH₵10.00 — past the PostgREST cap the old JS sum
-- was truncated by — plus 200 unpaid, plus 3 paid NGN orders of ₦500.00.
insert into public.orders (shop_id, seller_account_id, customer_id, currency, payment_status,
                           subtotal_minor, delivery_minor, total_minor, payment_method,
                           fulfillment_method_snapshot, buyer_snapshot, created_at)
select '09000000-0000-4000-8000-0000000000b1', '09000000-0000-4000-8000-0000000000a1',
       '09000000-0000-4000-8000-0000000000c1', v.currency::public.currency_code,
       v.payment_status::public.payment_status, v.amount, 0, v.amount, 'paystack', '{}'::jsonb,
       '{"name":"Kofi","phone":"+233241119002","country":"GH"}'::jsonb,
       timestamptz '2100-01-02 10:00+00'
  from (select 'GHS' as currency, 'paid' as payment_status, 1000::bigint as amount, generate_series(1, 1500)
        union all select 'GHS', 'unpaid', 1000, generate_series(1, 200)
        union all select 'NGN', 'paid', 50000, generate_series(1, 3)) v;

-- ---------------------------------------------------------------------------
-- admin_order_totals_since
-- ---------------------------------------------------------------------------
select results_eq(
  $$select currency::text, orders, paid_orders, gmv_minor
      from public.admin_order_totals_since('2100-01-01 00:00+00')$$,
  $$values ('GHS', 1700::bigint, 1500::bigint, 1500000::bigint),
           ('NGN', 3::bigint, 3::bigint, 150000::bigint)$$,
  'totals cover every order past 1,000 rows, one row per currency, largest first');

select is(
  (select count(*)::int from public.admin_order_totals_since('2100-01-03 00:00+00')),
  0, 'orders before p_since are excluded');

-- ---------------------------------------------------------------------------
-- admin_seller_gmv
-- ---------------------------------------------------------------------------
select results_eq(
  $$select currency::text, paid_orders, gmv_minor
      from public.admin_seller_gmv('09000000-0000-4000-8000-0000000000a1')$$,
  $$values ('GHS', 1500::bigint, 1500000::bigint), ('NGN', 3::bigint, 150000::bigint)$$,
  'one seller''s GMV is per currency and counts paid orders only');

select is(
  (select count(*)::int from public.admin_seller_gmv(gen_random_uuid())),
  0, 'an unknown seller has no GMV rows');

-- ---------------------------------------------------------------------------
-- admin_pending_payout_totals: a delta, because other rows may exist.
-- ---------------------------------------------------------------------------
create temporary table t_before as
select currency::text, requests, amount_minor from public.admin_pending_payout_totals();

insert into public.payout_requests (seller_account_id, amount_minor, currency, status)
select '09000000-0000-4000-8000-0000000000a1', 500, 'GHS', 'requested' from generate_series(1, 7);
insert into public.payout_requests (seller_account_id, amount_minor, currency, status)
values ('09000000-0000-4000-8000-0000000000a1', 900, 'GHS', 'paid');

select is(
  (select requests - coalesce((select requests from t_before where currency = 'GHS'), 0)
     from public.admin_pending_payout_totals() where currency = 'GHS'),
  7::bigint, 'every requested payout is counted — not only the five the page lists');
select is(
  (select amount_minor - coalesce((select amount_minor from t_before where currency = 'GHS'), 0)
     from public.admin_pending_payout_totals() where currency = 'GHS'),
  3500::bigint, 'pending money sums requested payouts only');

-- ---------------------------------------------------------------------------
-- admin_creator_dispute_counts
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('09000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'agg-creator@example.com', now(), now());
insert into public.creators (id, auth_user_id, handle, display_name, contact_phone, country, status)
values ('09000000-0000-4000-8000-0000000000e1', '09000000-0000-4000-8000-000000000002',
        'agg_creator', 'Agg Creator', '+233201119003', 'GH', 'active');
insert into public.creator_commission_payments (seller_account_id, creator_id, amount_minor, currency,
                                                method, marked_by, disputed_at)
select '09000000-0000-4000-8000-0000000000a1', '09000000-0000-4000-8000-0000000000e1', 100, 'GHS',
       'mobile_money', '09000000-0000-4000-8000-000000000001', case when n <= 12 then now() end
  from generate_series(1, 15) n;

select is(
  (select disputes from public.admin_creator_dispute_counts()
    where creator_id = '09000000-0000-4000-8000-0000000000e1'),
  12::bigint, 'disputed payments are counted per creator; undisputed ones are not');
select is(
  (select count(*)::int from public.admin_creator_dispute_counts() where disputes <= 0),
  0, 'only creators with a disputed payment are listed');

-- ---------------------------------------------------------------------------
-- Grants: service_role only.
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.admin_order_totals_since(timestamptz)', 'execute'),
  'authenticated cannot call admin_order_totals_since');
select ok(not has_function_privilege('anon', 'public.admin_order_totals_since(timestamptz)', 'execute'),
  'anon cannot call admin_order_totals_since');
select ok(has_function_privilege('service_role', 'public.admin_order_totals_since(timestamptz)', 'execute'),
  'service_role can call admin_order_totals_since');
select ok(not has_function_privilege('authenticated', 'public.admin_pending_payout_totals()', 'execute'),
  'authenticated cannot call admin_pending_payout_totals');
select ok(not has_function_privilege('authenticated', 'public.admin_seller_gmv(uuid)', 'execute'),
  'authenticated cannot call admin_seller_gmv');
select ok(not has_function_privilege('authenticated', 'public.admin_creator_dispute_counts()', 'execute'),
  'authenticated cannot call admin_creator_dispute_counts');
select ok(has_function_privilege('service_role', 'public.admin_seller_gmv(uuid)', 'execute'),
  'service_role can call admin_seller_gmv');

select is(
  (select prosecdef from pg_proc where oid = 'public.admin_order_totals_since(timestamptz)'::regprocedure),
  false, 'SECURITY INVOKER: no definer privilege to escalate through');

select is((select count(*)::int from public.check_ledger_invariants()), 0, 'ledger invariants hold');

select * from finish();
rollback;
