-- Platform-wide operator aggregates, computed in SQL.
--
-- The admin pages pulled every paid order, every commission, every partnership
-- and every subscription on the platform and reduced them in JavaScript. These
-- are the queries that grow fastest — they are not scoped to one seller — so
-- they are the first to cross db.max_rows and the last place anyone would
-- notice, because there is no per-seller figure to compare against. Platform
-- GMV, creator earnings and plan counts would simply have flattened.
--
-- SECURITY INVOKER, and granted to service_role only. The admin pages use the
-- service-role client, which bypasses RLS, so these see the whole platform
-- without needing a definer privilege — and no authenticated user can call them
-- at all. That is a smaller blast radius than SECURITY DEFINER plus an operator
-- check inside the function, which is the alternative.

-- ── Platform GMV per seller ─────────────────────────────────────────────────
create or replace function public.admin_seller_order_totals()
returns table (
  seller_account_id uuid,
  currency public.currency_code,
  gmv_minor bigint,
  paid_orders bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.seller_account_id, o.currency,
         sum(o.total_minor)::bigint,
         count(*)::bigint
  from public.orders o
  where o.payment_status = 'paid'
  group by o.seller_account_id, o.currency;
$$;

-- ── Which sellers have ever had a risk action ───────────────────────────────
-- Only the distinct set is used, to render a flag. Sending the whole table to
-- build a Set of ids is what the cap was truncating.
create or replace function public.admin_flagged_sellers()
returns table (seller_account_id uuid, actions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.seller_account_id, count(*)::bigint
  from public.risk_actions r
  group by r.seller_account_id;
$$;

-- ── Creator totals across every shop ────────────────────────────────────────
-- `earned` deliberately excludes reversed and void, matching the page: a
-- commission that was reversed was not earned.
create or replace function public.admin_creator_totals()
returns table (
  creator_id uuid,
  currency public.currency_code,
  partnerships bigint,
  earned_minor bigint,
  paid_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with commissions as (
    select c.creator_id, c.currency,
           coalesce(sum(c.amount_minor) filter (
             where c.status not in ('reversed', 'void')), 0)::bigint as earned_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'paid'), 0)::bigint as paid_minor
    from public.creator_commissions c
    group by c.creator_id, c.currency
  ),
  partnerships as (
    select p.creator_id, count(*)::bigint as partnerships
    from public.creator_partnerships p
    group by p.creator_id
  )
  select
    coalesce(c.creator_id, p.creator_id),
    c.currency,
    coalesce(p.partnerships, 0),
    coalesce(c.earned_minor, 0),
    coalesce(c.paid_minor, 0)
  from commissions c
  full outer join partnerships p on p.creator_id = c.creator_id;
$$;

-- ── How many sellers are on each plan ───────────────────────────────────────
create or replace function public.admin_plan_subscription_counts()
returns table (plan_id uuid, subscriptions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.plan_id, count(*)::bigint
  from public.seller_subscriptions s
  where s.plan_id is not null
  group by s.plan_id;
$$;

-- ── Paystack fee drift per country ──────────────────────────────────────────
-- A fee change only reaches sellers who onboard afterwards, because Paystack
-- holds percentage_charge on the subaccount. Counting the drift is what makes
-- "you changed the number and nobody is on it yet" visible, so it is precisely
-- the figure that must not be computed from a truncated list.
create or replace function public.admin_subaccount_fee_drift()
returns table (country public.country_code, total bigint, stale bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    sa.country,
    count(*)::bigint,
    count(*) filter (where ps.percentage_charge_bps is distinct from cc.platform_fee_bps)::bigint
  from public.payment_subaccounts ps
  join public.seller_accounts sa on sa.id = ps.seller_account_id
  join public.country_configs cc on cc.country = sa.country
  where ps.provider = 'paystack' and ps.status = 'active'
  group by sa.country;
$$;

-- Operators reach these through the service-role client. Nothing else may.
revoke execute on function public.admin_seller_order_totals()        from public, anon, authenticated;
revoke execute on function public.admin_flagged_sellers()            from public, anon, authenticated;
revoke execute on function public.admin_creator_totals()             from public, anon, authenticated;
revoke execute on function public.admin_plan_subscription_counts()   from public, anon, authenticated;
revoke execute on function public.admin_subaccount_fee_drift()       from public, anon, authenticated;

grant execute on function public.admin_seller_order_totals()        to service_role;
grant execute on function public.admin_flagged_sellers()            to service_role;
grant execute on function public.admin_creator_totals()             to service_role;
grant execute on function public.admin_plan_subscription_counts()   to service_role;
grant execute on function public.admin_subaccount_fee_drift()       to service_role;
