-- Seller trust score (flag `trust_score`, roadmap Phase 2, squad C).
--
-- One number per seller, recomputed nightly, that the storefront badge shows as
-- a tier and that Protect limits and instant payouts will read
-- (getTrustTier in src/lib/trust/score.ts). Computed in SQL, set-based and in
-- bounded keyset batches, because it aggregates every order a seller has had:
-- doing it through PostgREST would meet db.max_rows (see the analytics row-cap
-- incident) and quietly score big sellers on a truncated history.
--
-- ── Weights (version 'v1'; total 100) ──────────────────────────────────────
--   verification      25  verified 25; in progress / needs action 5; else 0
--   account_age       10  linear to 180 days
--   completed_orders  20  log scale, saturating at 100 completed orders
--   refund_rate       15  full at 0%, zero at >= 10% of settled orders refunded
--   dispute_rate      15  full at 0%, zero at >= 5% of orders with a support case
--   fulfilment_speed  10  median order -> shipment booked: full <= 24 h, zero >= 120 h
--   reviews            5  average published rating, 1 -> 0 and 5 -> 5
-- Rates, speed and reviews need evidence: with fewer than MIN_ORDERS orders
-- (or fewer than 3 reviews / 3 shipments) the component scores half its
-- weight — neither rewarded nor punished for having no history.
--
-- ── Tiers ───────────────────────────────────────────────────────────────────
--   new     fewer than 5 completed orders or an account under 30 days old —
--           not enough history to say anything, whatever the score
--   gold    score >= 80 and verified
--   silver  score >= 65
--   bronze  score >= 45
--   watch   below 45 with history. Never shown to buyers; for risk/limits only.
-- Only bronze, silver and gold are displayed on a storefront.
--
-- Deliberately not inputs yet (roadmap lists them; data does not exist):
-- OTP-confirmed deliveries (Protect), chargebacks, WhatsApp response time.

create table public.seller_trust_scores (
  seller_account_id uuid primary key references public.seller_accounts (id) on delete cascade,
  score smallint not null,
  tier text not null,
  components jsonb not null,
  weights_version text not null,
  computed_at timestamptz not null default now(),
  constraint seller_trust_scores_score_check check (score between 0 and 100),
  constraint seller_trust_scores_tier_check check (tier in ('new', 'bronze', 'silver', 'gold', 'watch')),
  constraint seller_trust_scores_components_check check (jsonb_typeof(components) = 'object')
);

comment on table public.seller_trust_scores is
  'Nightly seller trust score (compute_seller_trust_scores). Tier shown on storefronts when flag trust_score is on.';

create index seller_trust_scores_tier_idx on public.seller_trust_scores (tier);

alter table public.seller_trust_scores enable row level security;
alter table public.seller_trust_scores force row level security;
revoke all on public.seller_trust_scores from anon, authenticated;
grant select on public.seller_trust_scores to authenticated;

-- A seller may see their own breakdown (so a low score is explainable), an
-- operator any. Buyers get only the tier, through the server.
create policy seller_trust_scores_owner_operator_read on public.seller_trust_scores
  for select to authenticated
  using (
    seller_account_id = (select public.current_seller_account_id())
    or (select public.is_operator())
  );

-- The inputs are per-seller aggregates over orders and support cases; without
-- these every batch is a sequential scan of both tables.
create index if not exists orders_seller_created_idx on public.orders (seller_account_id, created_at desc);
create index if not exists support_cases_seller_idx on public.support_cases (seller_account_id);

-- ── One batch ───────────────────────────────────────────────────────────────
-- Keyset over seller_accounts.id: pass the last id returned to get the next
-- batch. Never offset-paged (rows are upserted as we go). Returns how many
-- sellers were scored and the last id, null when there are no more.
create or replace function public.compute_seller_trust_scores(
  p_batch integer default 500,
  p_after uuid default null
)
returns table (processed integer, last_seller_account_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch, 500), 1), 1000);
  v_ids uuid[];
begin
  select array_agg(id order by id) into v_ids
    from (
      select sa.id from public.seller_accounts sa
       where p_after is null or sa.id > p_after
       order by sa.id
       limit v_batch
    ) batch;

  if v_ids is null then
    return query select 0, null::uuid;
    return;
  end if;

  with sellers as (
    select sa.id, sa.created_at, coalesce(sv.state::text, 'not_started') as verification
      from public.seller_accounts sa
      left join public.seller_verifications sv on sv.seller_account_id = sa.id
     where sa.id = any (v_ids)
  ),
  order_stats as (
    select o.seller_account_id,
           count(*) filter (where o.status not in ('draft', 'pending', 'cancelled'))::numeric as placed,
           count(*) filter (where o.status = 'completed')::numeric as completed,
           count(*) filter (where o.refund_status in ('partial', 'completed'))::numeric as refunded
      from public.orders o
     where o.seller_account_id = any (v_ids)
       and o.created_at > now() - interval '365 days'
     group by o.seller_account_id
  ),
  all_time_completed as (
    select o.seller_account_id, count(*)::numeric as completed
      from public.orders o
     where o.seller_account_id = any (v_ids) and o.status = 'completed'
     group by o.seller_account_id
  ),
  case_stats as (
    select sc.seller_account_id, count(*)::numeric as cases
      from public.support_cases sc
     where sc.seller_account_id = any (v_ids)
       and sc.created_at > now() - interval '365 days'
     group by sc.seller_account_id
  ),
  speed as (
    select o.seller_account_id,
           count(*)::numeric as shipped,
           percentile_cont(0.5) within group (
             order by extract(epoch from (s.created_at - o.created_at)) / 3600.0
           ) as median_hours
      from public.orders o
      join public.shipments s on s.order_id = o.id
     where o.seller_account_id = any (v_ids)
       and o.created_at > now() - interval '180 days'
       and s.created_at >= o.created_at
     group by o.seller_account_id
  ),
  review_stats as (
    select r.seller_account_id, count(*)::numeric as reviews, avg(r.rating)::numeric as average
      from public.product_reviews r
     where r.seller_account_id = any (v_ids) and r.status = 'published'
     group by r.seller_account_id
  ),
  inputs as (
    select s.id,
           s.verification,
           extract(epoch from (now() - s.created_at)) / 86400.0 as age_days,
           coalesce(atc.completed, 0) as completed_all_time,
           coalesce(os.placed, 0) as placed,
           coalesce(os.refunded, 0) as refunded,
           coalesce(cs.cases, 0) as cases,
           coalesce(sp.shipped, 0) as shipped,
           sp.median_hours,
           coalesce(rs.reviews, 0) as reviews,
           rs.average as review_average
      from sellers s
      left join order_stats os on os.seller_account_id = s.id
      left join all_time_completed atc on atc.seller_account_id = s.id
      left join case_stats cs on cs.seller_account_id = s.id
      left join speed sp on sp.seller_account_id = s.id
      left join review_stats rs on rs.seller_account_id = s.id
  ),
  components as (
    select i.*,
      case i.verification
        when 'verified' then 25.0
        when 'in_progress' then 5.0
        when 'needs_action' then 5.0
        else 0.0 end as c_verification,
      10.0 * least(i.age_days / 180.0, 1.0) as c_age,
      20.0 * least(ln(1 + i.completed_all_time) / ln(101.0), 1.0) as c_orders,
      case when i.placed < 5 then 7.5
           else 15.0 * (1 - least((i.refunded / i.placed) / 0.10, 1.0)) end as c_refunds,
      case when i.placed < 5 then 7.5
           else 15.0 * (1 - least((i.cases / i.placed) / 0.05, 1.0)) end as c_disputes,
      case when i.shipped < 3 or i.median_hours is null then 5.0
           else 10.0 * (1 - least(greatest(i.median_hours - 24.0, 0) / 96.0, 1.0)) end as c_speed,
      case when i.reviews < 3 then 2.5
           else 5.0 * greatest(least((i.review_average - 1) / 4.0, 1.0), 0.0) end as c_reviews
    from inputs i
  ),
  scored as (
    select c.*,
      least(greatest(round(c.c_verification + c.c_age + c.c_orders + c.c_refunds
                           + c.c_disputes + c.c_speed + c.c_reviews), 0), 100)::smallint as total
    from components c
  )
  insert into public.seller_trust_scores
    (seller_account_id, score, tier, components, weights_version, computed_at)
  select sc.id,
         sc.total,
         case
           when sc.completed_all_time < 5 or sc.age_days < 30 then 'new'
           when sc.total >= 80 and sc.verification = 'verified' then 'gold'
           when sc.total >= 65 then 'silver'
           when sc.total >= 45 then 'bronze'
           else 'watch'
         end,
         jsonb_build_object(
           'verification', round(sc.c_verification::numeric, 2),
           'accountAge', round(sc.c_age::numeric, 2),
           'completedOrders', round(sc.c_orders::numeric, 2),
           'refundRate', round(sc.c_refunds::numeric, 2),
           'disputeRate', round(sc.c_disputes::numeric, 2),
           'fulfilmentSpeed', round(sc.c_speed::numeric, 2),
           'reviews', round(sc.c_reviews::numeric, 2),
           'inputs', jsonb_build_object(
             'verificationState', sc.verification,
             'ageDays', floor(sc.age_days),
             'completedOrders', sc.completed_all_time,
             'ordersLast365d', sc.placed,
             'refundedLast365d', sc.refunded,
             'casesLast365d', sc.cases,
             'shippedLast180d', sc.shipped,
             'medianHoursToShip', round(sc.median_hours::numeric, 1),
             'reviewCount', sc.reviews,
             'reviewAverage', round(sc.review_average, 2)
           )
         ),
         'v1',
         now()
    from scored sc
  on conflict (seller_account_id) do update
    set score = excluded.score,
        tier = excluded.tier,
        components = excluded.components,
        weights_version = excluded.weights_version,
        computed_at = excluded.computed_at;

  return query select array_length(v_ids, 1), v_ids[array_length(v_ids, 1)];
end;
$$;

-- ── Every seller, for the nightly job ───────────────────────────────────────
-- Loops batches inside one call. Bounded by p_max_batches so a runaway can
-- never hold the cron worker indefinitely; at 500 x 400 that is 200k sellers,
-- far beyond today, and the job logs if it ever stops short.
create or replace function public.run_seller_trust_scores(
  p_batch integer default 500,
  p_max_batches integer default 400
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after uuid := null;
  v_total integer := 0;
  v_processed integer;
  v_last uuid;
  i integer := 0;
begin
  loop
    select processed, last_seller_account_id into v_processed, v_last
      from public.compute_seller_trust_scores(p_batch, v_after);
    exit when v_processed = 0 or v_last is null;
    v_total := v_total + v_processed;
    v_after := v_last;
    i := i + 1;
    if i >= p_max_batches then
      raise warning 'run_seller_trust_scores stopped after % batches (% sellers); raise p_max_batches', i, v_total;
      exit;
    end if;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.compute_seller_trust_scores(integer, uuid) from public, anon, authenticated;
grant execute on function public.compute_seller_trust_scores(integer, uuid) to service_role;
revoke all on function public.run_seller_trust_scores(integer, integer) from public, anon, authenticated;
grant execute on function public.run_seller_trust_scores(integer, integer) to service_role;

-- Nightly, after the other 03:xx jobs have settled the day's orders. Runs in
-- SQL directly (no HTTP hop): the whole computation is here, and the app has
-- nothing to add.
select cron.schedule(
  'snapduka-trust-scores',
  '40 4 * * *',
  $job$select public.run_seller_trust_scores()$job$
);
