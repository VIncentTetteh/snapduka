-- supabase/migrations/202609040075_product_reviews.sql
--
-- Reviews and ratings.
--
-- The clearest product gap against Facebook Store: a SnapDuka storefront gave a
-- buyer no reason to believe anyone had ever bought from it. There were no
-- tables at all — not reviews, ratings, wishlists or follows.
--
-- Who may write one is the whole design. Buyers are guests: there is no buyer
-- auth anywhere in this product, and an order is reached with its
-- `tracking_token`, which is a bearer credential. So there is deliberately NO
-- insert policy here. A review is written by a server route that has already
-- matched a tracking token to the order, which is what makes every review a
-- verified purchase rather than an anonymous form submission.
--
-- Sellers may hide a review and reply to it. They may not edit what the buyer
-- wrote, which a trigger enforces rather than trusting the application: a
-- "review" a seller can rewrite is not social proof, it is marketing copy.

create type public.review_status as enum ('published', 'hidden');

create table public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- The proof of purchase. Cascade-deleting a review with its order is correct:
  -- a review with no order behind it is exactly what this table exists to
  -- prevent.
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  -- Snapshotted like buyer_snapshot on orders, so editing a customer record
  -- later cannot rewrite the name attached to a published review.
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 2000),
  status public.review_status not null default 'published',
  seller_reply text check (seller_reply is null or char_length(seller_reply) <= 2000),
  seller_replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One review per product per order. Buying the same item twice earns a second
  -- review; clicking submit twice does not.
  unique (order_id, product_id)
);

create index product_reviews_product_published_idx
  on public.product_reviews (product_id, created_at desc)
  where status = 'published';
create index product_reviews_seller_idx
  on public.product_reviews (seller_account_id, created_at desc);
create index product_reviews_shop_idx on public.product_reviews (shop_id);

create trigger product_reviews_set_updated_at
before update on public.product_reviews
for each row execute function public.set_updated_at();

-- A seller may moderate and reply. Everything the buyer wrote is immutable.
create function public.product_reviews_guard_buyer_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.rating is distinct from old.rating
     or new.body is distinct from old.body
     or new.author_name is distinct from old.author_name
     or new.product_id is distinct from old.product_id
     or new.order_id is distinct from old.order_id
     or new.seller_account_id is distinct from old.seller_account_id then
    raise exception 'A review''s content cannot be edited; only its status and the seller reply.';
  end if;
  -- Keep the reply timestamp honest without asking the caller to set it.
  if new.seller_reply is distinct from old.seller_reply then
    new.seller_replied_at := case when new.seller_reply is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger product_reviews_guard_buyer_content
before update on public.product_reviews
for each row execute function public.product_reviews_guard_buyer_content();

alter table public.product_reviews enable row level security;

-- Anyone browsing a published shop sees its published reviews. This is the
-- whole point of the feature, so it is deliberately open to anon.
create policy product_reviews_public_read on public.product_reviews
for select to anon, authenticated
using (
  status = 'published'
  and exists (
    select 1 from public.shops
    where shops.id = product_reviews.shop_id and shops.status = 'published'
  )
);

-- A seller sees every review of their own products, hidden ones included.
create policy product_reviews_seller_read on public.product_reviews
for select to authenticated
using (seller_account_id = (select public.current_seller_account_id()));

create policy product_reviews_seller_update on public.product_reviews
for update to authenticated
using (seller_account_id = (select public.current_seller_account_id()))
with check (seller_account_id = (select public.current_seller_account_id()));

-- No insert or delete policy: reviews are created by a server route that has
-- verified the order's tracking token, and are removed only with their order.

/**
 * Published rating and count per product.
 *
 * SECURITY INVOKER so the caller's RLS decides what they may aggregate — a
 * DEFINER view here would leak hidden reviews' ratings back through the
 * average, which is precisely what hiding one is meant to prevent.
 */
create view public.product_review_stats
with (security_invoker = true) as
select
  product_id,
  count(*)::bigint as review_count,
  round(avg(rating)::numeric, 2) as rating_avg
from public.product_reviews
where status = 'published'
group by product_id;

grant select on public.product_review_stats to anon, authenticated;
