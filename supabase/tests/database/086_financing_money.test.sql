-- Stock financing money paths: disbursement, sweep, remittance, partner cash,
-- closure. The sweep never takes more than owed, never pushes the seller's
-- available balance negative, and every path leaves the books balanced.

begin;

set local search_path = extensions, public;

select plan(40);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
update public.country_configs set platform_fee_bps = 700, payout_hold_days = 3 where country = 'GH';
-- Thresholds opened right up: this file is about money, 085 about eligibility.
update public.financing_policies
   set enabled = true, partner = 'sandbox', min_account_age_days = 0, min_gmv_90d_minor = 0, min_orders_90d = 0,
       max_refund_rate_bps = 10000, max_chargeback_rate_bps = 10000,
       eligible_tiers = array['new', 'bronze', 'silver', 'gold', 'watch'], require_verified = false,
       offer_gmv_bps = 10000, min_offer_minor = 1000, max_offer_minor = 30000,
       fee_bps = 600, sweep_bps = 5000, platform_fee_share_bps = 5000, terms_version = 'v1'
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('08600000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'fin086-' || n || '@example.com', now(), now()
  from generate_series(1, 2) n;

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, settlement_mode_override, created_at)
select ('08600000-0000-4000-8000-0000000000a' || n)::uuid, ('08600000-0000-4000-8000-00000000000' || n)::uuid,
       'GH', 'active', true, 'Fin ' || n, 'fin086-' || n || '@example.com', 'ledger', now() - interval '1 year'
  from generate_series(1, 2) n;

insert into public.seller_trust_scores (seller_account_id, score, tier, components, weights_version)
select ('08600000-0000-4000-8000-0000000000a' || n)::uuid, 70, 'silver', '{}'::jsonb, 'v1'
  from generate_series(1, 2) n;

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
select ('08600000-0000-4000-8000-0000000000b' || n)::uuid, ('08600000-0000-4000-8000-0000000000a' || n)::uuid,
       'fin086-shop-' || n, 'Fin Shop ' || n, 'Fin Shop Ltd', 'GH', 'GHS', 'published', now()
  from generate_series(1, 2) n;

insert into public.customers (id, seller_account_id, name, email, phone, country)
select ('08600000-0000-4000-8000-0000000000c' || n)::uuid, ('08600000-0000-4000-8000-0000000000a' || n)::uuid,
       'Esi', 'esi' || n || '@example.com', '+23324111086' || n, 'GH'
  from generate_series(1, 2) n;

-- Places, pays (real Paystack success path), completes and releases one order.
create or replace function pg_temp.sell(p_seller int, p_total bigint) returns uuid language plpgsql as $$
declare
  v_order uuid := gen_random_uuid();
  v_seller uuid := ('08600000-0000-4000-8000-0000000000a' || p_seller)::uuid;
begin
  insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor,
                             delivery_minor, total_minor, payment_method, fulfillment_method_snapshot, buyer_snapshot)
  values (v_order, ('08600000-0000-4000-8000-0000000000b' || p_seller)::uuid, v_seller,
          ('08600000-0000-4000-8000-0000000000c' || p_seller)::uuid, 'GHS', p_total, 0, p_total, 'paystack',
          '{}'::jsonb, '{"name":"Esi","phone":"+233241110860"}'::jsonb);
  insert into public.payment_attempts (order_id, seller_account_id, reference, amount_minor, currency, status)
  values (v_order, v_seller, 'fin086_' || v_order, p_total, 'GHS', 'pending');
  perform public.apply_paystack_success('fin086_' || v_order, 'evt:fin086_' || v_order,
    jsonb_build_object('data', jsonb_build_object('status', 'success', 'amount', p_total,
                                                  'currency', 'GHS', 'fees', 0)));
  update public.orders set status = 'completed' where id = v_order;
  update public.order_settlements set release_at = now() - interval '1 minute' where order_id = v_order;
  perform public.release_due_order_settlements();
  return v_order;
end $$;

create or replace function pg_temp.bal(p_kind text, p_seller int default null) returns bigint language sql as $$
  select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
   where kind::text = p_kind and currency = 'GHS'
     and owner_seller_account_id is not distinct from
         case when p_seller is null then null else ('08600000-0000-4000-8000-0000000000a' || p_seller)::uuid end;
$$;

-- All test postings share one transaction, so now() is one instant. The
-- sweep's "released after disbursement" test compares timestamps; move the
-- pre-disbursement releases back an hour to give them a real "before".
create or replace function pg_temp.age_releases(p_seller int) returns void language plpgsql as $$
begin
  alter table public.ledger_transactions disable trigger ledger_transactions_immutable;
  update public.ledger_transactions set posted_at = posted_at - interval '1 hour'
   where kind = 'hold_release' and seller_account_id = ('08600000-0000-4000-8000-0000000000a' || p_seller)::uuid;
  alter table public.ledger_transactions enable trigger ledger_transactions_immutable;
end $$;

-- Seller 1: three GH₵100 sales before financing (GMV 30000 -> offer 30000, fee 1800).
select pg_temp.sell(1, 10000) from generate_series(1, 3);
select pg_temp.age_releases(1);

create temporary table t_adv as
select public.accept_financing_offer(
         public.create_financing_offer('08600000-0000-4000-8000-0000000000a1'),
         '08600000-0000-4000-8000-0000000000a1', '08600000-0000-4000-8000-000000000001', 31800, 'v1') as id;

select is((select row(principal_minor, fee_minor, total_repayable_minor, partner_share_minor, platform_fee_share_minor)::text
             from public.financing_advances where id = (select id from t_adv)),
  '(30000,1800,31800,30900,900)', 'advance terms: 6% fee, half of it SnapDuka''s contractual share');

-- ---------------------------------------------------------------------------
-- Disbursement
-- ---------------------------------------------------------------------------
select is(pg_temp.bal('seller_available', 1), 27900::bigint, 'before: three releases of 9300 available');
select isnt(public.record_financing_disbursement((select id from t_adv), 'SBX-FUND-1'), null::uuid,
  'the partner funding the advance posts a disbursement');
select is(pg_temp.bal('seller_available', 1), 57900::bigint, 'the principal is credited as available');
-- partner_clearing is an asset (debit-normal since 202609250290): money the
-- partner owes SnapDuka reads positive.
select is(pg_temp.bal('partner_clearing'), 30000::bigint, 'and the partner owes SnapDuka that cash until it lands');
select is(public.record_financing_disbursement((select id from t_adv), 'SBX-FUND-1'), null::uuid,
  'a replayed confirmation is a no-op');
select throws_ok(format($$select public.record_financing_disbursement(%L, 'SBX-OTHER')$$, (select id from t_adv)),
  '55000', null, 'a second, different disbursement is refused');
select is((select state::text from public.financing_advances where id = (select id from t_adv)), 'disbursed',
  'state: disbursed');

-- ---------------------------------------------------------------------------
-- Sweeps
-- ---------------------------------------------------------------------------
select is((public.sweep_financing_repayments()->>'sweeps')::int, 0,
  'releases from before the disbursement are never swept');

-- GH₵200 sale: seller gross 18600, half swept = 9300.
select pg_temp.sell(1, 20000);
select is(public.sweep_financing_repayments()->>'sweptMinor', '9300', 'sweep takes sweep_bps of the release');
select is(pg_temp.bal('financing_payable', 1), 9300::bigint, 'into the seller''s financing_payable');
select is(pg_temp.bal('seller_available', 1), 67200::bigint, 'out of their available balance');
select is((select state::text from public.financing_advances where id = (select id from t_adv)), 'repaying',
  'state: repaying');
select is((public.sweep_financing_repayments()->>'sweeps')::int, 0, 'a release is swept exactly once');

-- The seller withdraws everything and then a refund claws back 15000, leaving
-- them in arrears; the next release (18600) only brings them to 3600.
select public.post_ledger_transaction('test_withdraw', 'test:fin086:withdraw', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'seller_available', 'seller_account_id', '08600000-0000-4000-8000-0000000000a1', 'amount_minor', 67200),
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -67200)),
  '08600000-0000-4000-8000-0000000000a1');
select public.post_ledger_transaction('test_clawback', 'test:fin086:clawback', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'seller_available', 'seller_account_id', '08600000-0000-4000-8000-0000000000a1', 'amount_minor', 15000),
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -15000)),
  '08600000-0000-4000-8000-0000000000a1');
select pg_temp.sell(1, 20000);
select is(public.sweep_financing_repayments()->>'sweptMinor', '3600',
  'the sweep takes only what the balance can cover (target was 9300)');
select is(pg_temp.bal('seller_available', 1), 0::bigint, 'and never pushes available below zero');
select is((select shortfall_minor from public.financing_sweeps
            where advance_id = (select id from t_adv) and swept_minor = 3600),
  5700::bigint, 'the gap is recorded as a shortfall, not carried forward');

-- ---------------------------------------------------------------------------
-- Remittance (before repayment completes: all of it is the partner's)
-- ---------------------------------------------------------------------------
select is(public.remit_financing_payables()->>'remittedMinor', '12900', 'swept money is remitted');
select is(pg_temp.bal('financing_payable', 1), 0::bigint, 'financing_payable is emptied');
select is(pg_temp.bal('partner_clearing'), 17100::bigint, 'and now offsets what the partner owes (30000 - 12900)');
select is(pg_temp.bal('financing_fee_revenue'), 0::bigint, 'the partner is paid first: no fee share yet');
select is((public.remit_financing_payables()->>'advances')::int, 0, 'nothing left to remit');

-- ---------------------------------------------------------------------------
-- Repaid: a GH₵1000 sale would sweep 46500 but only 18900 is still owed.
-- ---------------------------------------------------------------------------
select pg_temp.sell(1, 100000);
select is(public.sweep_financing_repayments()->>'sweptMinor', '18900', 'never sweeps more than is owed');
select is((select row(state, swept_minor)::text from public.financing_advances where id = (select id from t_adv)),
  '(repaid,31800)', 'state: repaid, swept exactly the total repayable');
select pg_temp.sell(1, 10000);
select is((public.sweep_financing_repayments()->>'sweeps')::int, 0, 'a repaid advance sweeps nothing more');

select public.remit_financing_payables();
select is((select row(remitted_minor, fee_revenue_minor)::text from public.financing_advances where id = (select id from t_adv)),
  '(30900,900)', 'partner receives its share in full; SnapDuka''s contractual share comes out last');
select is(pg_temp.bal('financing_fee_revenue'), 900::bigint, 'the share is booked as financing_fee_revenue');

-- ---------------------------------------------------------------------------
-- Partner cash
-- ---------------------------------------------------------------------------
select is(pg_temp.bal('partner_clearing'), -900::bigint, 'net: SnapDuka owes the partner 900 (30900 received - 30000 funded), a negative asset');
select is((select row(partner, due_minor)::text from public.financing_partner_amounts_due() where currency = 'GHS'),
  '(sandbox,30900)', 'the settle worker sees the full remitted amount as due to the partner');
select throws_ok($$select public.record_partner_settlement('GHS', 'to_partner', 31000, 'bank-086-a')$$,
  '23514', null, 'cannot record paying the partner more than was remitted to them');
select lives_ok($$select public.record_partner_settlement('GHS', 'to_partner', 30900, 'bank-086-out')$$,
  'transferring remitted repayments is allowed before the partner''s funding is recorded');
select is((select due_minor from public.financing_partner_amounts_due() where currency = 'GHS'), 0::bigint,
  'nothing is due once transferred');
select throws_ok($$select public.record_partner_settlement('GHS', 'from_partner', 30001, 'bank-086-b')$$,
  '23514', null, 'cannot record receiving more funding than was disbursed');
select lives_ok($$select public.record_partner_settlement('GHS', 'from_partner', 30000, 'bank-086-fund')$$,
  'the partner''s funding landing is recorded');
select is(public.record_partner_settlement('GHS', 'from_partner', 30000, 'bank-086-fund'), null::uuid,
  'a replayed settlement reference is a no-op');
select is(pg_temp.bal('partner_clearing'), 0::bigint, 'fully settled with the partner: clearing is zero');

-- ---------------------------------------------------------------------------
-- Closure: seller 2 defaults part-way.
-- ---------------------------------------------------------------------------
select pg_temp.sell(2, 10000);
select pg_temp.age_releases(2);
create temporary table t_adv2 as
select public.accept_financing_offer(
         public.create_financing_offer('08600000-0000-4000-8000-0000000000a2'),
         '08600000-0000-4000-8000-0000000000a2', '08600000-0000-4000-8000-000000000002', 10600, 'v1') as id;
select public.record_financing_disbursement((select id from t_adv2), 'SBX-FUND-2');
select public.close_financing_advance((select id from t_adv2), 'defaulted', 'Partner declared default');
select pg_temp.sell(2, 20000);
select is((public.sweep_financing_repayments()->>'sweeps')::int, 0, 'a defaulted advance is no longer swept');

select throws_ok($$select public.post_ledger_transaction('test_bad', 'test:fin086:neg', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'financing_payable', 'seller_account_id', '08600000-0000-4000-8000-0000000000a1', 'amount_minor', 1),
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -1)))$$,
  '23514', null, 'financing_payable can never go negative');

select is((select count(*)::int from public.check_ledger_invariants()), 0, 'the ledger balances');
select is((select count(*)::int from public.check_financial_product_invariants()), 0,
  'advances, sweeps and the ledger agree');

select * from finish();
rollback;
