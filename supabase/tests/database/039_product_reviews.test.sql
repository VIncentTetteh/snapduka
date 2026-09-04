-- product_reviews exists to make a storefront believable, so the properties
-- that matter are about trust, not storage:
--
--   1. A seller can hide a review and reply to it, but cannot rewrite what the
--      buyer said. A review a seller can edit is marketing copy, not proof.
--   2. Hiding a review removes it from the published average, which is the
--      whole point of hiding it.
--   3. There is no insert policy at all. Reviews are written by a server route
--      that has already matched an order's tracking_token, which is what makes
--      every review a verified purchase.

begin;

set local search_path = extensions, public;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('a5a50000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'reviews@rpc.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('b5b50000-0000-4000-8000-000000000001', 'a5a50000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Review Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('c5c50000-0000-4000-8000-000000000001', 'b5b50000-0000-4000-8000-000000000001',
        'review-shop', 'Review Shop', 'GH', 'GHS', 'published', now());

-- An `active` product needs published_at, and a `track` product needs stock —
-- both are CHECK constraints, not conventions.
insert into public.products (id, shop_id, seller_account_id, name, slug, currency,
                             price_minor, status, published_at, stock_quantity)
values ('d5d50000-0000-4000-8000-000000000001', 'c5c50000-0000-4000-8000-000000000001',
        'b5b50000-0000-4000-8000-000000000001', 'Kente wrap', 'kente-wrap', 'GHS',
        18000, 'active', now(), 10);

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('e5e50000-0000-4000-8000-0000000000c1', 'b5b50000-0000-4000-8000-000000000001',
        'Ama', 'ama@review.test', '+233201234572', 'GH');

insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values ('f5f50000-0000-4000-8000-000000000001', 'c5c50000-0000-4000-8000-000000000001',
        'b5b50000-0000-4000-8000-000000000001', 'e5e50000-0000-4000-8000-0000000000c1',
        'GHS', 'completed', 'paid', 'fulfilled', 'paystack', 18000, 0, 18000,
        '{"name":"Ama"}'::jsonb, '{"type":"pickup"}'::jsonb);

insert into public.product_reviews (
  id, seller_account_id, shop_id, product_id, order_id, customer_id, author_name, rating, body)
values ('11150000-0000-4000-8000-000000000001', 'b5b50000-0000-4000-8000-000000000001',
        'c5c50000-0000-4000-8000-000000000001', 'd5d50000-0000-4000-8000-000000000001',
        'f5f50000-0000-4000-8000-000000000001', 'e5e50000-0000-4000-8000-0000000000c1',
        'Ama', 5, 'Beautiful fabric.');

-- Nobody may insert directly: the route is the only writer.
select is_empty(
  $$select policyname from pg_policies
    where tablename = 'product_reviews' and cmd = 'INSERT'$$,
  'there is no insert policy — reviews come from a verified-order route only'
);

select is_empty(
  $$select policyname from pg_policies
    where tablename = 'product_reviews' and cmd = 'DELETE'$$,
  'there is no delete policy — a review dies with its order, not by hand'
);

select is(
  (select count(*) from pg_policies where tablename = 'product_reviews'),
  3::bigint,
  'exactly three policies: public read, seller read, seller update'
);

-- Ratings are bounded.
select throws_ok(
  $$insert into public.product_reviews
      (seller_account_id, shop_id, product_id, order_id, author_name, rating)
    values ('b5b50000-0000-4000-8000-000000000001','c5c50000-0000-4000-8000-000000000001',
            'd5d50000-0000-4000-8000-000000000001','f5f50000-0000-4000-8000-000000000001','X',6)$$,
  '23514',
  null,
  'a rating above 5 is rejected'
);

-- One review per product per order.
select throws_ok(
  $$insert into public.product_reviews
      (seller_account_id, shop_id, product_id, order_id, author_name, rating)
    values ('b5b50000-0000-4000-8000-000000000001','c5c50000-0000-4000-8000-000000000001',
            'd5d50000-0000-4000-8000-000000000001','f5f50000-0000-4000-8000-000000000001','X',4)$$,
  '23505',
  null,
  'the same product cannot be reviewed twice for one order'
);

-- The seller may not rewrite the buyer.
select throws_ok(
  $$update public.product_reviews set rating = 1
    where id = '11150000-0000-4000-8000-000000000001'$$,
  null,
  'A review''s content cannot be edited; only its status and the seller reply.',
  'a seller cannot change the rating'
);

select throws_ok(
  $$update public.product_reviews set body = 'Actually it was terrible'
    where id = '11150000-0000-4000-8000-000000000001'$$,
  null,
  'A review''s content cannot be edited; only its status and the seller reply.',
  'a seller cannot rewrite the review body'
);

-- Replying is allowed, and stamps itself.
update public.product_reviews set seller_reply = 'Thank you!'
where id = '11150000-0000-4000-8000-000000000001';

select isnt(
  (select seller_replied_at from public.product_reviews
   where id = '11150000-0000-4000-8000-000000000001'),
  null,
  'replying stamps seller_replied_at without the caller setting it'
);

-- Hiding removes the review from the published average.
update public.product_reviews set status = 'hidden'
where id = '11150000-0000-4000-8000-000000000001';

select is_empty(
  $$select product_id from public.product_review_stats
    where product_id = 'd5d50000-0000-4000-8000-000000000001'$$,
  'a hidden review no longer counts toward the published rating'
);

select * from finish();

rollback;
