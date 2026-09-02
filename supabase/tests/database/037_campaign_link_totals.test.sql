-- campaign_link_totals replaces a JavaScript reduce over every
-- campaign_attributions row, which PostgREST silently truncated at
-- db.max_rows. Two properties matter and are asserted here rather than left to
-- review:
--
--   1. It stays SECURITY INVOKER. That is the entire safety argument: it reads
--      only campaign_attributions, which RLS already scopes to the caller. As
--      SECURITY DEFINER it would hand any authenticated caller every seller's
--      campaign performance, because it takes no account id to check.
--   2. A row carrying an order_id is a conversion, not a click. Counting every
--      row as a click made each order inflate the click total too, which is the
--      bug the application-side split existed to avoid.

begin;

set local search_path = extensions, public;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('a3a30000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'campaign@rpc.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('b3b30000-0000-4000-8000-000000000001', 'a3a30000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Campaign Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('c3c30000-0000-4000-8000-000000000001', 'b3b30000-0000-4000-8000-000000000001',
        'campaign-shop', 'Campaign Shop', 'GH', 'GHS', 'published', now());

insert into public.campaign_links (id, seller_account_id, shop_id, name, token, channel, destination_path)
values
  ('d3d30000-0000-4000-8000-000000000001', 'b3b30000-0000-4000-8000-000000000001',
   'c3c30000-0000-4000-8000-000000000001', 'TikTok drop', 'tok-tiktok-1', 'tiktok', '/'),
  ('d3d30000-0000-4000-8000-000000000002', 'b3b30000-0000-4000-8000-000000000001',
   'c3c30000-0000-4000-8000-000000000001', 'WhatsApp status', 'tok-whatsapp-1', 'whatsapp', '/');

-- orders.customer_id is NOT NULL, so the conversion needs a real buyer.
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('e3e30000-0000-4000-8000-0000000000c1', 'b3b30000-0000-4000-8000-000000000001',
        'Campaign Buyer', 'buyer@campaign.test', '+233201234570', 'GH');

insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot, created_at)
values ('e3e30000-0000-4000-8000-000000000001', 'c3c30000-0000-4000-8000-000000000001',
        'b3b30000-0000-4000-8000-000000000001', 'e3e30000-0000-4000-8000-0000000000c1',
        'GHS', 'completed', 'paid', 'fulfilled',
        'paystack', 5000, 0, 5000, '{"name":"Buyer"}'::jsonb, '{"type":"pickup"}'::jsonb, now());

-- Three plain clicks and one conversion on the first link; one click on the second.
insert into public.campaign_attributions (campaign_id, seller_account_id, order_id, session_key)
values
  ('d3d30000-0000-4000-8000-000000000001', 'b3b30000-0000-4000-8000-000000000001', null, 's1'),
  ('d3d30000-0000-4000-8000-000000000001', 'b3b30000-0000-4000-8000-000000000001', null, 's2'),
  ('d3d30000-0000-4000-8000-000000000001', 'b3b30000-0000-4000-8000-000000000001', null, 's3'),
  ('d3d30000-0000-4000-8000-000000000001', 'b3b30000-0000-4000-8000-000000000001',
   'e3e30000-0000-4000-8000-000000000001', 's4'),
  ('d3d30000-0000-4000-8000-000000000002', 'b3b30000-0000-4000-8000-000000000001', null, 's5');

select is(
  (select prokind from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'campaign_link_totals'),
  'f',
  'campaign_link_totals is a plain function'
);

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'campaign_link_totals'),
  false,
  'campaign_link_totals is SECURITY INVOKER, so RLS scopes it to the caller'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3a30000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select clicks from public.campaign_link_totals()
   where campaign_id = 'd3d30000-0000-4000-8000-000000000001'),
  3::bigint,
  'the converting row is not counted as a click'
);

select is(
  (select orders from public.campaign_link_totals()
   where campaign_id = 'd3d30000-0000-4000-8000-000000000001'),
  1::bigint,
  'a row carrying an order_id counts as one conversion'
);

select is(
  (select clicks from public.campaign_link_totals()
   where campaign_id = 'd3d30000-0000-4000-8000-000000000002'),
  1::bigint,
  'each campaign is totalled separately'
);

select is(
  (select count(*) from public.campaign_link_totals()),
  2::bigint,
  'only campaigns the caller can read are returned'
);

select * from finish();

rollback;
