-- The rest of the seller dashboard, aggregated in SQL.
--
-- Same defect as 202609050085 and 202609020072: rows pulled unbounded and
-- reduced in JavaScript, capped by PostgREST at db.max_rows = 1000 with no
-- error. 202608070069 already added seller_analytics_summary and
-- seller_product_profit for exactly this, and the web dashboards adopted only
-- the first of them.
--
-- `growth/insights` is the clearest illustration: it carries a comment saying
-- this bug was fixed — true of the rates, which do use the RPC — directly above
-- a "Top products" query that still had it.
--
-- All three are SECURITY INVOKER and take no seller id: they read only what the
-- caller can already read, and RLS scopes them.

-- ── Top products by units sold ──────────────────────────────────────────────
-- seller_product_profit orders by revenue, and the insights page ranks by
-- quantity, so taking its first page and re-sorting would rank a truncated set
-- by the wrong key. Ordering and limiting in SQL means the answer is exact and
-- the response is bounded by p_limit rather than by the server cap.
create or replace function public.seller_top_products(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 10
)
returns table (
  product_id uuid,
  product_name text,
  units_sold bigint,
  revenue_minor bigint
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
    sum(l.line_total_minor)::bigint as revenue_minor
  from public.order_lines l
  join public.orders o on o.id = l.order_id
  where o.created_at >= p_from and o.created_at < p_to
  group by l.product_id
  order by sum(l.quantity) desc, max(l.product_name) asc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

comment on function public.seller_top_products(timestamptz, timestamptz, integer) is
  'Best-selling products by units, from the caller''s own order lines. SECURITY INVOKER: RLS scopes it.';

-- ── One product's profit ────────────────────────────────────────────────────
-- The product page pulled every paid line for that product to compute a single
-- row. A separate name rather than a defaulted parameter on
-- seller_product_profit: an overload creates two candidates for one PostgREST
-- call, and ambiguity in the schema is what took production down earlier today
-- (202609050084).
--
-- Semantics mirror seller_product_profit exactly, including the rule that a
-- missing unit cost yields NULL profit rather than zero — a product whose cost
-- was never entered has unknown profit, and reporting that as zero margin would
-- be a confident wrong answer.
create or replace function public.seller_product_profit_for(
  p_product_id uuid,
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
  where l.product_id = p_product_id
    and o.payment_status = 'paid'
    and o.created_at >= p_from and o.created_at < p_to
  group by l.product_id;
$$;

comment on function public.seller_product_profit_for(uuid, timestamptz, timestamptz) is
  'Revenue, cost and profit for one product. SECURITY INVOKER: RLS scopes it.';

-- ── What the seller owes each of their creators ─────────────────────────────
-- The creators page pulled the whole commission ledger to build a per-creator
-- balance and an "owed now" total. creator_commission_balances answers this for
-- one creator; this answers it for all of them in one round trip, which is what
-- a list needs.
create or replace function public.seller_creator_commission_totals()
returns table (
  creator_id uuid,
  currency public.currency_code,
  pending_minor bigint,
  payable_minor bigint,
  paid_minor bigint,
  reversed_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.creator_id,
    c.currency,
    coalesce(sum(c.amount_minor) filter (where c.status = 'pending'), 0)::bigint,
    coalesce(sum(c.amount_minor) filter (where c.status = 'payable'), 0)::bigint,
    coalesce(sum(c.amount_minor) filter (where c.status = 'paid'), 0)::bigint,
    coalesce(sum(c.amount_minor) filter (where c.status = 'reversed'), 0)::bigint
  from public.creator_commissions c
  group by c.creator_id, c.currency;
$$;

comment on function public.seller_creator_commission_totals() is
  'Per-creator commission totals for the calling seller''s own shop. SECURITY INVOKER: RLS scopes it.';

revoke execute on function public.seller_top_products(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.seller_top_products(timestamptz, timestamptz, integer) to authenticated, service_role;

revoke execute on function public.seller_product_profit_for(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.seller_product_profit_for(uuid, timestamptz, timestamptz) to authenticated, service_role;

revoke execute on function public.seller_creator_commission_totals() from public, anon;
grant execute on function public.seller_creator_commission_totals() to authenticated, service_role;
