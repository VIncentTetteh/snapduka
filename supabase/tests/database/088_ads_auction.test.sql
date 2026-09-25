-- Promoted listings auction: who gets a sponsored slot and what each pays.
-- Generalised second price with a reserve, one slot per seller, and only
-- campaigns that are flagged on, funded, within today's budget and pointing at
-- a live, in-stock product.

begin;

set local search_path = extensions, public;

select plan(11);

update public.ad_policies
   set min_bid_minor = 20, max_bid_minor = 2000, min_daily_budget_minor = 100,
       max_daily_budget_minor = 100000, min_top_up_minor = 100, sponsored_slots = 3, max_products_per_campaign = 5
 where country = 'GH';

-- Five sellers. 1..4 are flagged on; 5 is not.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('08800000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'ads088-' || n || '@example.com', now(), now()
  from generate_series(1, 5) n;
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email)
select ('08800000-0000-4000-8000-0000000000a' || n)::uuid, ('08800000-0000-4000-8000-00000000000' || n)::uuid,
       'GH', 'active', true, 'Ads ' || n, 'ads088-' || n || '@example.com'
  from generate_series(1, 5) n;
insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
select ('08800000-0000-4000-8000-0000000000b' || n)::uuid, ('08800000-0000-4000-8000-0000000000a' || n)::uuid,
       'ads088-shop-' || n, 'Ads Shop ' || n, 'Ads Shop Ltd', 'GH', 'GHS', 'published', now()
  from generate_series(1, 5) n;
insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status,
                             published_at, stock_quantity)
select ('08800000-0000-4000-8000-0000000000d' || n)::uuid, ('08800000-0000-4000-8000-0000000000b' || n)::uuid,
       ('08800000-0000-4000-8000-0000000000a' || n)::uuid, 'Product ' || n, 'product-' || n, 'GHS', 5000,
       'active', now(), 5
  from generate_series(1, 5) n;
insert into public.feature_flags (key, seller_account_id, enabled)
select 'promoted_listings', ('08800000-0000-4000-8000-0000000000a' || n)::uuid, true
  from generate_series(1, 4) n;

-- Each seller: GH₵50 available, GH₵10 of it as ad budget.
do $$
declare n int;
begin
  for n in 1..5 loop
    perform public.post_ledger_transaction('test_credit', 'test:ads088:credit:' || n, 'GHS',
      jsonb_build_array(
        jsonb_build_object('kind', 'processor_clearing', 'amount_minor', 5000),
        jsonb_build_object('kind', 'seller_available', 'seller_account_id',
                           ('08800000-0000-4000-8000-0000000000a' || n)::uuid, 'amount_minor', -5000)),
      ('08800000-0000-4000-8000-0000000000a' || n)::uuid);
    perform public.ads_top_up(('08800000-0000-4000-8000-0000000000a' || n)::uuid, 1000, 'topup-088-' || n);
  end loop;
end $$;

-- Bids: seller1 300 (and a weaker second campaign at 250), seller2 200,
-- seller3 100, seller4 50, seller5 900 (not flagged).
create temporary table t_c (seller int, bid bigint, id uuid);
insert into t_c
select s, b, public.create_ad_campaign(('08800000-0000-4000-8000-0000000000a' || s)::uuid, 'C' || s || '-' || b,
         array[('08800000-0000-4000-8000-0000000000d' || s)::uuid], 5000, b,
         ('08800000-0000-4000-8000-00000000000' || s)::uuid)
  from (values (1, 300), (1, 250), (2, 200), (3, 100), (4, 50), (5, 900)) v(s, b);

create or replace function pg_temp.slots() returns text language sql as $$
  select string_agg(right(seller_account_id::text, 1) || ':' || bid_minor || '/' || cost_per_click_minor, ' ')
    from public.sponsored_listings('GH', null);
$$;

select is(pg_temp.slots(), '1:300/201 2:200/101 3:100/51',
  'top three by bid, one per seller; each pays the next bid + 1, never more than its own');
select is((select count(*)::int from public.sponsored_listings('GH', null)
            where seller_account_id = '08800000-0000-4000-8000-0000000000a5'), 0,
  'a seller without the promoted_listings flag is never shown, whatever the bid');
select is((select count(*)::int from public.sponsored_listings('NG', null)), 0, 'markets are separate');

-- Seller 2 pauses: 4 moves up and, now last, pays the reserve.
select public.update_ad_campaign((select id from t_c where seller = 2), '08800000-0000-4000-8000-0000000000a2', 'pause');
select is(pg_temp.slots(), '1:300/101 3:100/51 4:50/20', 'paused campaigns leave the auction; the last slot pays the reserve');
select public.update_ad_campaign((select id from t_c where seller = 2), '08800000-0000-4000-8000-0000000000a2', 'resume');

-- Seller 1's best campaign exhausts today's budget: its second campaign stands in.
update public.ad_campaigns set daily_budget_minor = 300 where id = (select id from t_c where seller = 1 and bid = 300);
select public.record_ad_click((select id from t_c where seller = 1 and bid = 300),
                              '08800000-0000-4000-8000-0000000000d1', 'viewer-088-a', 300);
select is(pg_temp.slots(), '1:250/201 2:200/101 3:100/51',
  'a campaign with no budget left today drops out; the seller''s next campaign competes');

-- Sold out: seller 3's only product has no free stock.
update public.products set stock_quantity = 0 where id = '08800000-0000-4000-8000-0000000000d3';
select is(pg_temp.slots(), '1:250/201 2:200/51 4:50/20', 'a sold-out product is never promoted (and the price below it moves)');
update public.products set stock_quantity = 5 where id = '08800000-0000-4000-8000-0000000000d3';

-- Unfunded: seller 2 withdraws their budget below their bid.
select public.ads_withdraw('08800000-0000-4000-8000-0000000000a2', 900, 'withdraw-088-2');
select is((select state::text from public.ad_campaigns where seller_account_id = '08800000-0000-4000-8000-0000000000a2'),
  'out_of_funds', 'a campaign whose balance cannot pay its bid is out_of_funds');
select is(pg_temp.slots(), '1:250/101 3:100/51 4:50/20', 'and leaves the auction');

select is((select count(*)::int from public.sponsored_listings('GH', 1)), 1, 'the caller can ask for fewer slots');

set local role authenticated;
select throws_ok($$select * from public.sponsored_listings('GH', null)$$, '42501', null,
  'the auction is server-only');
reset role;

select is((select count(*)::int from public.check_financial_product_invariants()), 0, 'books agree');

select * from finish();
rollback;
