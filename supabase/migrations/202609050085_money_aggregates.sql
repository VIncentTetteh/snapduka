-- Aggregate the money figures in SQL instead of in JavaScript.
--
-- `db.max_rows = 1000` (supabase/config.toml:8). Every one of these screens
-- selected rows with no bound and reduced them on the client, so past a
-- thousand rows the number shown is simply wrong — silently, with no error and
-- no truncation notice. 202609020072 fixed exactly this for campaign links and
-- was never extended to the rest.
--
-- These are the money ones, and they are the ones where being wrong is worst:
-- what a seller has earned, and what a creator is owed.
--
-- Nothing is over the cap today (55 orders, 6 commissions), so no figure on
-- screen is currently wrong. This is the fix landing before the bug does.
--
-- Both are SECURITY INVOKER, like seller_analytics_summary: they read only
-- tables the caller can already read, RLS scopes them to the caller's own rows,
-- and there is no definer privilege to get wrong.

-- ── What the seller has earned ──────────────────────────────────────────────
-- Mirrors summariseEarnings() in @snapduka/core exactly: refunded is counted
-- apart, pending and offline_due are "awaiting payment", and only 'paid' rows
-- reach the online/offline split. ONLINE_METHODS there is the single value
-- 'paystack'.
--
-- Unlike the JavaScript, this groups by currency. summariseEarnings has no
-- currency dimension, so a seller holding orders in two currencies would have
-- had cedis added to naira — the same defect that
-- calculateCreatorBalancesByCurrency was written to fix on the creator side. No
-- seller has more than one order currency today, so no figure changes; the
-- caller picks the row for its own currency and a second currency can no longer
-- silently contaminate it.
create or replace function public.seller_earnings_summary()
returns table (
  currency public.currency_code,
  settled_online_minor bigint,
  collected_offline_minor bigint,
  awaiting_payment_minor bigint,
  refunded_minor bigint,
  total_paid_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    o.currency,
    coalesce(sum(o.total_minor) filter (
      where o.payment_status = 'paid' and o.payment_method = 'paystack'), 0)::bigint,
    coalesce(sum(o.total_minor) filter (
      where o.payment_status = 'paid' and o.payment_method <> 'paystack'), 0)::bigint,
    coalesce(sum(o.total_minor) filter (
      where o.payment_status in ('pending', 'offline_due')), 0)::bigint,
    coalesce(sum(o.total_minor) filter (
      where o.payment_status = 'refunded'), 0)::bigint,
    coalesce(sum(o.total_minor) filter (
      where o.payment_status = 'paid'), 0)::bigint
  from public.orders o
  where o.payment_status in ('paid', 'pending', 'offline_due', 'refunded')
  group by o.currency;
$$;

comment on function public.seller_earnings_summary() is
  'Earnings by payment state and method, per currency, from the caller''s own orders. SECURITY INVOKER: RLS scopes it.';

-- ── What a creator is owed ──────────────────────────────────────────────────
-- The portal listed commissions with .limit(50) and fed that same array to
-- calculateCreatorBalancesByCurrency. Fifty is right for a recent-activity
-- list and wrong for a balance: the 51st commission onward simply did not
-- count towards what the creator is owed.
--
-- p_creator_id is a filter, not an authorisation: RLS still decides which rows
-- are visible. That makes the function correct for both readers of this ledger.
-- A creator calling it gets their whole balance across every shop. A seller
-- calling it sees only commissions on their own shop, which is precisely "what
-- I owe this creator" — the number the partnership page needs.
--
-- owed_now and carry_over mirror calculateCreatorBalance: adjustments net off
-- the payable balance, and a negative result is carried rather than discarded
-- so it offsets the next payable commission instead of vanishing.
create or replace function public.creator_commission_balances(p_creator_id uuid)
returns table (
  currency public.currency_code,
  pending_minor bigint,
  payable_minor bigint,
  paid_minor bigint,
  reversed_minor bigint,
  owed_now_minor bigint,
  carry_over_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with commissions as (
    select c.currency,
           coalesce(sum(c.amount_minor) filter (where c.status = 'pending'), 0)::bigint  as pending_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'payable'), 0)::bigint  as payable_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'paid'), 0)::bigint     as paid_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'reversed'), 0)::bigint as reversed_minor
    from public.creator_commissions c
    where c.creator_id = p_creator_id
    group by c.currency
  ),
  adjustments as (
    select a.currency, coalesce(sum(a.delta_minor), 0)::bigint as delta_minor
    from public.creator_commission_adjustments a
    where a.creator_id = p_creator_id
    group by a.currency
  ),
  -- An adjustment can be the only row in its currency: a reversal that outlives
  -- the commission it cancelled still has to show as carry-over.
  currencies as (
    select currency from commissions
    union
    select currency from adjustments
  )
  select
    cur.currency,
    coalesce(c.pending_minor, 0),
    coalesce(c.payable_minor, 0),
    coalesce(c.paid_minor, 0),
    coalesce(c.reversed_minor, 0),
    greatest(0, coalesce(c.payable_minor, 0) + coalesce(a.delta_minor, 0)),
    least(0, coalesce(c.payable_minor, 0) + coalesce(a.delta_minor, 0))
  from currencies cur
  left join commissions c on c.currency = cur.currency
  left join adjustments a on a.currency = cur.currency;
$$;

comment on function public.creator_commission_balances(uuid) is
  'Creator commission balance per currency over the whole ledger, not a page of it. SECURITY INVOKER: RLS decides whose rows are counted.';

-- Postgres grants EXECUTE to PUBLIC on creation. Revoke, then grant
-- deliberately — same as 202608070069.
revoke execute on function public.seller_earnings_summary() from public, anon;
grant execute on function public.seller_earnings_summary() to authenticated, service_role;

revoke execute on function public.creator_commission_balances(uuid) from public, anon;
grant execute on function public.creator_commission_balances(uuid) to authenticated, service_role;
