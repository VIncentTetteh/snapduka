-- supabase/migrations/202608070069_seller_analytics_rpcs.sql
--
-- Aggregate a seller's own analytics in the database instead of on the device.
--
-- The mobile insights screen ran `select event_type from analytics_events` with
-- no bound and counted three values in JavaScript. On a shop with any traffic
-- that is the entire event history downloaded over mobile data to produce three
-- integers, and it gets worse every day the shop stays open. The profit screen
-- had a different problem: it compared products.price_minor to
-- products.cost_minor, which is a price list, not profit — it knows nothing
-- about what actually sold.
--
-- Both are SECURITY INVOKER, deliberately. They read only tables the caller can
-- already read, so RLS scopes them to the caller's own rows and there is no
-- definer privilege to get wrong. The seller account id is not a parameter for
-- the same reason: it cannot be used to read someone else's shop.

create or replace function public.seller_analytics_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  visits bigint,
  product_views bigint,
  checkout_starts bigint,
  orders_placed bigint,
  paid_orders bigint,
  paid_total_minor bigint,
  distinct_buyers bigint,
  repeat_buyers bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with events as (
    select event_type
    from public.analytics_events
    where created_at >= p_from and created_at < p_to
  ),
  paid as (
    select customer_id, total_minor
    from public.orders
    where created_at >= p_from and created_at < p_to
      and payment_status = 'paid'
  ),
  buyers as (
    select customer_id, count(*) as order_count
    from paid
    where customer_id is not null
    group by customer_id
  )
  select
    (select count(*) from events where event_type = 'visit'),
    (select count(*) from events where event_type = 'product_view'),
    (select count(*) from events where event_type = 'checkout_start'),
    (select count(*) from public.orders
      where created_at >= p_from and created_at < p_to),
    (select count(*) from paid),
    (select coalesce(sum(total_minor), 0) from paid),
    (select count(*) from buyers),
    (select count(*) from buyers where order_count > 1);
$$;

comment on function public.seller_analytics_summary(timestamptz, timestamptz) is
  'Pre-aggregated funnel counts for the calling seller. SECURITY INVOKER: RLS scopes it.';

-- Per-product revenue and profit from what actually sold.
--
-- unit_cost_minor is snapshotted onto the line at the time of sale
-- (202607200035), so re-pricing a product does not rewrite the margin on orders
-- already placed. A null cost stays null all the way to the UI rather than
-- being coalesced to zero, which would report a 100% margin for a product whose
-- cost simply has not been entered.
create or replace function public.seller_product_profit(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  product_id uuid,
  product_name text,
  units_sold bigint,
  revenue_minor bigint,
  cost_minor bigint,
  profit_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.product_id,
    max(l.product_name) as product_name,
    sum(l.quantity)::bigint as units_sold,
    sum(l.line_total_minor)::bigint as revenue_minor,
    case when bool_or(l.unit_cost_minor is null) then null
         else sum(l.unit_cost_minor * l.quantity)::bigint end as cost_minor,
    case when bool_or(l.unit_cost_minor is null) then null
         else (sum(l.line_total_minor) - sum(l.unit_cost_minor * l.quantity))::bigint end
      as profit_minor
  from public.order_lines l
  join public.orders o on o.id = l.order_id
  where o.payment_status = 'paid'
    and o.created_at >= p_from and o.created_at < p_to
  group by l.product_id
  order by sum(l.line_total_minor) desc;
$$;

comment on function public.seller_product_profit(timestamptz, timestamptz) is
  'Revenue, cost and profit per product from paid order lines. SECURITY INVOKER: RLS scopes it.';

-- Postgres grants EXECUTE to PUBLIC on creation, and 202608010065 exists
-- because that was once how anon could mark orders paid. Revoke, then grant
-- deliberately.
revoke execute on function public.seller_analytics_summary(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.seller_analytics_summary(timestamptz, timestamptz)
  to authenticated, service_role;

revoke execute on function public.seller_product_profit(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.seller_product_profit(timestamptz, timestamptz)
  to authenticated, service_role;

-- The order_lines join filters on orders.created_at and payment_status; without
-- this the profit query sequential-scans a seller's whole order history.
create index if not exists orders_seller_paid_created_idx
  on public.orders (seller_account_id, created_at desc)
  where payment_status = 'paid';
