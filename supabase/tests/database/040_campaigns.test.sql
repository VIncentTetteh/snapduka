-- Campaigns, and the totals a seller judges one by.
--
-- Two properties carry the weight here:
--
--   1. campaign_totals() stays SECURITY INVOKER. It takes no account id, so RLS
--      is the only thing scoping it to the caller — as SECURITY DEFINER it
--      would hand any authenticated caller every seller's campaign
--      performance. Same argument as campaign_link_totals(), asserted in 037.
--   2. A row carrying an order_id is a conversion, not a click, and only money
--      that actually arrived counts as revenue. Getting either wrong makes a
--      campaign look like it worked when it did not.

begin;

set local search_path = extensions, public;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('a8a80000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'campaigns@rpc.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('b8b80000-0000-4000-8000-000000000001', 'a8a80000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Campaign Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('c8c80000-0000-4000-8000-000000000001', 'b8b80000-0000-4000-8000-000000000001',
        'campaigns-shop', 'Campaigns Shop', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('e8e80000-0000-4000-8000-0000000000c1', 'b8b80000-0000-4000-8000-000000000001',
        'Ama', 'ama@campaigns.test', '+233201234574', 'GH');

insert into public.campaigns (id, seller_account_id, shop_id, name, objective, status, starts_at, ends_at)
values ('11180000-0000-4000-8000-000000000001', 'b8b80000-0000-4000-8000-000000000001',
        'c8c80000-0000-4000-8000-000000000001', 'December drop',
        'Sell 40 wrappers before Christmas', 'active', '2026-12-01', '2026-12-24');

insert into public.campaign_links (
  id, seller_account_id, shop_id, name, token, channel, destination_path, campaign_id)
values
  ('d8d80000-0000-4000-8000-000000000001', 'b8b80000-0000-4000-8000-000000000001',
   'c8c80000-0000-4000-8000-000000000001', 'December drop · tiktok', 'dec-drop-t', 'tiktok',
   '/campaigns-shop', '11180000-0000-4000-8000-000000000001'),
  ('d8d80000-0000-4000-8000-000000000002', 'b8b80000-0000-4000-8000-000000000001',
   'c8c80000-0000-4000-8000-000000000001', 'December drop · instagram', 'dec-drop-i', 'instagram',
   '/campaigns-shop', '11180000-0000-4000-8000-000000000001');

-- A paid order and an unpaid one, so revenue has something to exclude.
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values
  ('f8f80000-0000-4000-8000-000000000001', 'c8c80000-0000-4000-8000-000000000001',
   'b8b80000-0000-4000-8000-000000000001', 'e8e80000-0000-4000-8000-0000000000c1',
   'GHS', 'completed', 'paid', 'fulfilled', 'paystack', 18000, 0, 18000,
   '{"name":"Ama"}'::jsonb, '{"type":"pickup"}'::jsonb),
  ('f8f80000-0000-4000-8000-000000000002', 'c8c80000-0000-4000-8000-000000000001',
   'b8b80000-0000-4000-8000-000000000001', 'e8e80000-0000-4000-8000-0000000000c1',
   'GHS', 'pending', 'pending', 'unconfirmed', 'paystack', 5000, 0, 5000,
   '{"name":"Ama"}'::jsonb, '{"type":"pickup"}'::jsonb);

-- Three plain clicks (one of them counted twice) and two conversions.
insert into public.campaign_attributions
  (campaign_id, seller_account_id, order_id, visitor_key, click_count)
values
  ('d8d80000-0000-4000-8000-000000000001', 'b8b80000-0000-4000-8000-000000000001', null, 'v1', 2),
  ('d8d80000-0000-4000-8000-000000000002', 'b8b80000-0000-4000-8000-000000000001', null, 'v2', 1),
  ('d8d80000-0000-4000-8000-000000000001', 'b8b80000-0000-4000-8000-000000000001',
   'f8f80000-0000-4000-8000-000000000001', 'v3', 1),
  ('d8d80000-0000-4000-8000-000000000002', 'b8b80000-0000-4000-8000-000000000001',
   'f8f80000-0000-4000-8000-000000000002', 'v4', 1);

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'campaign_totals'),
  false,
  'campaign_totals is SECURITY INVOKER, so RLS scopes it to the caller'
);

-- A campaign cannot end before it starts.
select throws_ok(
  $$insert into public.campaigns (seller_account_id, shop_id, name, starts_at, ends_at)
    values ('b8b80000-0000-4000-8000-000000000001','c8c80000-0000-4000-8000-000000000001',
            'Backwards', '2026-12-24', '2026-12-01')$$,
  '23514',
  null,
  'a campaign cannot end before it starts'
);

select throws_ok(
  $$insert into public.campaigns (seller_account_id, shop_id, name)
    values ('b8b80000-0000-4000-8000-000000000001','c8c80000-0000-4000-8000-000000000001','   ')$$,
  '23514',
  null,
  'a campaign must be named something'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a8a80000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select clicks from public.campaign_totals()
   where campaign_id = '11180000-0000-4000-8000-000000000001'),
  3::bigint,
  'converting rows are conversions, not clicks'
);

select is(
  (select orders from public.campaign_totals()
   where campaign_id = '11180000-0000-4000-8000-000000000001'),
  2::bigint,
  'both conversions are counted, paid or not'
);

select is(
  (select revenue_minor from public.campaign_totals()
   where campaign_id = '11180000-0000-4000-8000-000000000001'),
  18000::bigint,
  'only money that actually arrived counts as revenue'
);

select is(
  (select count(*) from public.campaign_totals()),
  1::bigint,
  'only campaigns the caller can read are returned'
);

-- The links of two channels roll up into one campaign row, which is the whole
-- reason this table exists.
select is(
  (select count(*) from public.campaign_links
   where campaign_id = '11180000-0000-4000-8000-000000000001'),
  2::bigint,
  'one campaign holds its per-channel links'
);

select * from finish();

rollback;
