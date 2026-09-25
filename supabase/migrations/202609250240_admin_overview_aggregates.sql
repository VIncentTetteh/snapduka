-- Admin overview, seller detail and creator dispute figures, computed in SQL.
--
-- The admin overview still pulled every paid order of the last 30 days and
-- summed total_minor in JavaScript. PostgREST caps every response at
-- db.max_rows = 1000, so past a thousand paid orders a month platform GMV and
-- the "% paid" share silently stopped growing — the exact failure 202609050087
-- fixed on the sellers page, surviving on the page operators look at first.
--
-- The same page's "Pending payouts" tile counted and summed a list fetched with
-- .limit(5) for display, so it could never show more than five requests or the
-- money behind the sixth. The seller detail page summed every paid order of one
-- seller (unbounded, and across currencies as if they were one), and the
-- creators page counted disputed payments from an unbounded list.
--
-- SECURITY INVOKER + service_role only, following 202609050087: the admin
-- pages use the service-role client, so these see the whole platform without a
-- definer privilege, and no authenticated user can call them at all.
--
-- GMV here is payment_status = 'paid', matching admin_seller_order_totals on
-- the sellers page, so the overview and the seller list agree. The north-star
-- table also counts partially_refunded orders; that difference is deliberate
-- and labelled on the page.

-- ── Orders and GMV since a point in time, per currency ──────────────────────
create or replace function public.admin_order_totals_since(p_since timestamptz)
returns table (
  currency public.currency_code,
  orders bigint,
  paid_orders bigint,
  gmv_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.currency,
         count(*)::bigint,
         count(*) filter (where o.payment_status = 'paid')::bigint,
         -- sum(bigint) is numeric; cast at the aggregate (see
         -- plpgsql-handlers-hide-resolution-errors).
         coalesce(sum(o.total_minor) filter (where o.payment_status = 'paid'), 0)::bigint
    from public.orders o
   where o.created_at >= p_since
   group by o.currency
   order by 4 desc, 1;
$$;

-- ── Payout requests waiting on an operator, per currency ────────────────────
create or replace function public.admin_pending_payout_totals()
returns table (
  currency public.currency_code,
  requests bigint,
  amount_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.currency, count(*)::bigint, coalesce(sum(p.amount_minor), 0)::bigint
    from public.payout_requests p
   where p.status = 'requested'
   group by p.currency
   order by 3 desc, 1;
$$;

-- ── One seller's all-time GMV, per currency ─────────────────────────────────
-- admin_seller_order_totals() answers for every seller; filtering its output
-- would still aggregate the whole platform (a function with SET is never
-- inlined, so the filter cannot be pushed down). This one reads one seller's
-- rows through orders_seller_paid_created_idx.
create or replace function public.admin_seller_gmv(p_seller_account_id uuid)
returns table (
  currency public.currency_code,
  paid_orders bigint,
  gmv_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.currency, count(*)::bigint, coalesce(sum(o.total_minor), 0)::bigint
    from public.orders o
   where o.seller_account_id = p_seller_account_id
     and o.payment_status = 'paid'
   group by o.currency
   order by 3 desc, 1;
$$;

-- ── Disputed creator payments per creator ───────────────────────────────────
create or replace function public.admin_creator_dispute_counts()
returns table (creator_id uuid, disputes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.creator_id, count(*)::bigint
    from public.creator_commission_payments p
   where p.disputed_at is not null
   group by p.creator_id;
$$;

revoke execute on function public.admin_order_totals_since(timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_pending_payout_totals()         from public, anon, authenticated;
revoke execute on function public.admin_seller_gmv(uuid)                from public, anon, authenticated;
revoke execute on function public.admin_creator_dispute_counts()        from public, anon, authenticated;

grant execute on function public.admin_order_totals_since(timestamptz) to service_role;
grant execute on function public.admin_pending_payout_totals()         to service_role;
grant execute on function public.admin_seller_gmv(uuid)                to service_role;
grant execute on function public.admin_creator_dispute_counts()        to service_role;
