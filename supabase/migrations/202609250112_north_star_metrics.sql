-- The north-star metrics for the trust-and-money strategy, computed in SQL.
--
-- Weekly transacting sellers (a seller with at least one paid order that week)
-- is the measure of whether sellers actually run their business through
-- SnapDuka; GMV through Protect is the measure of whether the trust product is
-- working. Aggregated here, never by counting rows in JavaScript — the admin
-- overview's JS sum over paid orders is exactly the pattern db.max_rows breaks.
--
-- SECURITY INVOKER + service_role only, following 202609050087.

create or replace function public.admin_north_star(p_weeks integer default 8)
returns table (
  week_start date,
  currency public.currency_code,
  transacting_sellers bigint,
  paid_orders bigint,
  gmv_minor bigint,
  protect_orders bigint,
  protect_gmv_minor bigint,
  protect_fee_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('week', o.created_at)::date,
         o.currency,
         count(distinct o.seller_account_id)::bigint,
         count(*)::bigint,
         sum(o.total_minor)::bigint,
         count(*) filter (where o.protection_mode = 'protect')::bigint,
         coalesce(sum(o.total_minor) filter (where o.protection_mode = 'protect'), 0)::bigint,
         coalesce(sum(o.protect_fee_minor), 0)::bigint
    from public.orders o
   where o.payment_status in ('paid', 'partially_refunded')
     and o.created_at >= date_trunc('week', now()) - make_interval(weeks => least(greatest(p_weeks, 1), 52) - 1)
   group by 1, 2
   order by 1 desc, 2;
$$;

revoke execute on function public.admin_north_star(integer) from public, anon, authenticated;
grant execute on function public.admin_north_star(integer) to service_role;
