-- Promoted listings money paths: prepaid top-up from the wallet, one billed
-- click per viewer per day, daily budgets, pausing at zero, withdrawal of
-- unused budget — and the books balance after every one.

begin;

set local search_path = extensions, public;

select plan(33);

update public.ad_policies
   set min_bid_minor = 20, max_bid_minor = 2000, min_daily_budget_minor = 100,
       max_daily_budget_minor = 100000, min_top_up_minor = 500, sponsored_slots = 3, max_products_per_campaign = 5
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('08700000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'ads087-' || n || '@example.com', now(), now()
  from generate_series(1, 2) n;
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email)
select ('08700000-0000-4000-8000-0000000000a' || n)::uuid, ('08700000-0000-4000-8000-00000000000' || n)::uuid,
       'GH', 'active', true, 'Ads ' || n, 'ads087-' || n || '@example.com'
  from generate_series(1, 2) n;
insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
select ('08700000-0000-4000-8000-0000000000b' || n)::uuid, ('08700000-0000-4000-8000-0000000000a' || n)::uuid,
       'ads087-shop-' || n, 'Ads Shop ' || n, 'Ads Shop Ltd', 'GH', 'GHS', 'published', now()
  from generate_series(1, 2) n;
insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status, published_at, stock_quantity)
values ('08700000-0000-4000-8000-0000000000d1', '08700000-0000-4000-8000-0000000000b1',
        '08700000-0000-4000-8000-0000000000a1', 'Kente scarf', 'kente-scarf', 'GHS', 15000, 'active', now(), 10),
       ('08700000-0000-4000-8000-0000000000d2', '08700000-0000-4000-8000-0000000000b1',
        '08700000-0000-4000-8000-0000000000a1', 'Draft thing', 'draft-thing', 'GHS', 1000, 'draft', null, 10),
       ('08700000-0000-4000-8000-0000000000d3', '08700000-0000-4000-8000-0000000000b2',
        '08700000-0000-4000-8000-0000000000a2', 'Other seller bag', 'bag', 'GHS', 9000, 'active', now(), 10);

-- GH₵100 withdrawable for seller 1.
select public.post_ledger_transaction('test_credit', 'test:ads087:credit', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', 10000),
    jsonb_build_object('kind', 'seller_available', 'seller_account_id', '08700000-0000-4000-8000-0000000000a1',
                       'amount_minor', -10000)),
  '08700000-0000-4000-8000-0000000000a1');

create or replace function pg_temp.bal(p_kind text, p_seller int default 1) returns bigint language sql as $$
  select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
   where kind::text = p_kind and currency = 'GHS'
     and owner_seller_account_id is not distinct from
         case when p_seller is null then null else ('08700000-0000-4000-8000-0000000000a' || p_seller)::uuid end;
$$;

-- ---------------------------------------------------------------------------
-- Top-up
-- ---------------------------------------------------------------------------
select throws_ok($$select public.ads_top_up('08700000-0000-4000-8000-0000000000a1', 100, 'topup-087-small')$$,
  '22023', null, 'below the minimum top-up is refused');
select throws_ok($$select public.ads_top_up('08700000-0000-4000-8000-0000000000a1', 20000, 'topup-087-big')$$,
  '55000', null, 'a top-up can never exceed the available balance (ads are never credit)');

create temporary table t_top as
select public.ads_top_up('08700000-0000-4000-8000-0000000000a1', 1000, 'topup-087-a') as id;
select is(pg_temp.bal('ads_prepaid'), 1000::bigint, 'top-up credits the prepaid ad balance');
select is(pg_temp.bal('seller_available'), 9000::bigint, 'from the available balance');
select is(public.ads_top_up('08700000-0000-4000-8000-0000000000a1', 1000, 'topup-087-a'), (select id from t_top),
  'a double-submitted top-up is applied once');
select is(pg_temp.bal('ads_prepaid'), 1000::bigint, 'still 1000 after the replay');

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
select throws_ok($$select public.create_ad_campaign('08700000-0000-4000-8000-0000000000a1', 'Bad',
    array['08700000-0000-4000-8000-0000000000d3']::uuid[], 300, 100, '08700000-0000-4000-8000-000000000001')$$,
  '22023', null, 'a seller cannot promote another seller''s product');
select throws_ok($$select public.create_ad_campaign('08700000-0000-4000-8000-0000000000a1', 'Bad',
    array['08700000-0000-4000-8000-0000000000d2']::uuid[], 300, 100, '08700000-0000-4000-8000-000000000001')$$,
  '22023', null, 'a draft product cannot be promoted');
select throws_ok($$select public.create_ad_campaign('08700000-0000-4000-8000-0000000000a1', 'Bad',
    array['08700000-0000-4000-8000-0000000000d1']::uuid[], 300, 10, '08700000-0000-4000-8000-000000000001')$$,
  '22023', null, 'a bid below the market minimum is refused');
select throws_ok($$select public.create_ad_campaign('08700000-0000-4000-8000-0000000000a1', 'Bad',
    array['08700000-0000-4000-8000-0000000000d1']::uuid[], 100, 200, '08700000-0000-4000-8000-000000000001')$$,
  '22023', null, 'a daily budget smaller than one click is refused');

create temporary table t_c as
select public.create_ad_campaign('08700000-0000-4000-8000-0000000000a1', 'Scarves',
         array['08700000-0000-4000-8000-0000000000d1']::uuid[], 250, 100, '08700000-0000-4000-8000-000000000001') as id;
select is((select state::text from public.ad_campaigns where id = (select id from t_c)), 'active',
  'a funded campaign starts active');

-- ---------------------------------------------------------------------------
-- Clicks
-- ---------------------------------------------------------------------------
select is(public.record_ad_click((select id from t_c), '08700000-0000-4000-8000-0000000000d1', 'viewer-087-aaaa', 100),
  'billed', 'a click is billed');
select is(pg_temp.bal('ads_prepaid'), 900::bigint, 'from prepaid');
select is(pg_temp.bal('ads_revenue', null), 100::bigint, 'to ads revenue');
select is(public.record_ad_click((select id from t_c), '08700000-0000-4000-8000-0000000000d1', 'viewer-087-aaaa', 100),
  'duplicate', 'the same viewer clicking again today is not billed');
select is(public.record_ad_click((select id from t_c), '08700000-0000-4000-8000-0000000000d3', 'viewer-087-bbbb', 100),
  'inactive', 'a click for a product outside the campaign is not billed');
select is(public.record_ad_click((select id from t_c), '08700000-0000-4000-8000-0000000000d1', 'viewer-087-bbbb', 500),
  'billed', 'a signed price above the current bid...');
select is((select price_minor from public.ad_clicks where viewer_key = 'viewer-087-bbbb'), 100::bigint,
  '...is charged at the bid');
select is(public.record_ad_click((select id from t_c), '08700000-0000-4000-8000-0000000000d1', 'viewer-087-cccc', 100),
  'over_budget', 'a click that would exceed the daily budget is not billed (200 + 100 > 250)');
select is(pg_temp.bal('ads_prepaid'), 800::bigint, 'only two clicks were charged');

-- ---------------------------------------------------------------------------
-- Pause and resume
-- ---------------------------------------------------------------------------
select is(public.update_ad_campaign((select id from t_c), '08700000-0000-4000-8000-0000000000a1', 'pause')::text,
  'paused', 'the seller can pause');
select is(public.record_ad_click((select id from t_c), '08700000-0000-4000-8000-0000000000d1', 'viewer-087-dddd', 20),
  'inactive', 'a paused campaign bills nothing');
select throws_ok(format($$select public.update_ad_campaign(%L, '08700000-0000-4000-8000-0000000000a2', 'resume')$$,
                        (select id from t_c)),
  'P0002', null, 'another seller cannot touch the campaign');

-- ---------------------------------------------------------------------------
-- Out of funds and withdrawal
-- ---------------------------------------------------------------------------
select throws_ok($$select public.ads_withdraw('08700000-0000-4000-8000-0000000000a1', 900, 'withdraw-087-x')$$,
  '55000', null, 'cannot withdraw more than the unused budget');
select lives_ok($$select public.ads_withdraw('08700000-0000-4000-8000-0000000000a1', 750, 'withdraw-087-a')$$,
  'unused budget can be moved back');
select is(pg_temp.bal('seller_available'), 9750::bigint, 'to the available balance');
select is(public.update_ad_campaign((select id from t_c), '08700000-0000-4000-8000-0000000000a1', 'resume')::text,
  'out_of_funds', 'resuming with 50 left against a 100 bid lands in out_of_funds');
select lives_ok($$select public.ads_top_up('08700000-0000-4000-8000-0000000000a1', 500, 'topup-087-b')$$,
  'topping up...');
select is((select state::text from public.ad_campaigns where id = (select id from t_c)), 'active',
  '...puts an out_of_funds campaign back in the auction');

select throws_ok($$select public.post_ledger_transaction('test_bad', 'test:ads087:neg', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'ads_prepaid', 'seller_account_id', '08700000-0000-4000-8000-0000000000a1', 'amount_minor', 100000),
    jsonb_build_object('kind', 'ads_revenue', 'amount_minor', -100000)))$$,
  '23514', null, 'ads_prepaid can never go negative');

select is((select row(clicks_today, spent_today_minor, clicks_total, spent_total_minor)::text
             from public.seller_ad_campaign_stats('08700000-0000-4000-8000-0000000000a1')
            where campaign_id = (select id from t_c)),
  '(2,200,2,200)', 'campaign stats are aggregated in SQL');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'the ledger balances');
select is((select count(*)::int from public.check_financial_product_invariants()), 0,
  'ads revenue equals billed clicks');

select * from finish();
rollback;
