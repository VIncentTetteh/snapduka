-- supabase/tests/database/025_plan_versioning_integrity.test.sql
--
-- Publishing a new plan version is the riskiest routine change in this schema:
-- plan_prices and seller_subscriptions both reference plans by id, and billing
-- resolves `plans where code=X and active` then `plan_prices where plan_id`.
-- A version bump that forgets either one breaks paid checkout silently, and
-- only when a seller tries to subscribe. These assertions are the guard rail
-- for every future entitlement addition, not just the creator program.
begin;

set local search_path = extensions, public;

select plan(9);

-- The partial unique index is what forces the retire-then-insert dance.
select is(
  (select count(*)::int from (select code from public.plans where active group by code having count(*) > 1) x),
  0,
  'exactly one active version per plan code'
);

-- Failure 1: prices left behind on the retired version. Free legitimately has
-- no prices, so it is excluded rather than special-cased away.
select is(
  (select count(*)::int from public.plans p
    where p.active and p.code <> 'free'
      and not exists (select 1 from public.plan_prices pp where pp.plan_id = p.id and pp.active)),
  0,
  'every active paid plan still resolves at least one active price'
);

select is(
  (select count(*)::int from public.plans p
    cross join (values ('GH'::public.country_code), ('NG'::public.country_code)) as c(country)
    cross join (values ('monthly'), ('yearly')) as i(interval)
    where p.active and p.code <> 'free'
      and not exists (
        select 1 from public.plan_prices pp
        where pp.plan_id = p.id and pp.country = c.country
          and pp.interval = i.interval and pp.active)),
  0,
  'every active paid plan has GH and NG prices at both intervals'
);

-- Failure 2: subscribers stranded on entitlements they are no longer paying
-- for, because getSellerPlan embeds plans!plan_id.
select is(
  (select count(*)::int from public.seller_subscriptions s
    join public.plans p on p.id = s.plan_id where not p.active),
  0,
  'no subscription points at a retired plan version'
);

select is(
  (select count(*)::int from public.seller_subscriptions s
    join public.plans p on p.id = s.pending_plan_id where not p.active),
  0,
  'no pending plan change points at a retired plan version'
);

-- A remapped price must belong to the plan the subscription now sits on,
-- otherwise renewal charges the wrong amount.
select is(
  (select count(*)::int from public.seller_subscriptions s
    join public.plan_prices pp on pp.id = s.price_id
    where pp.plan_id <> s.plan_id),
  0,
  'every subscription price belongs to the plan the subscription is on'
);

select is(
  (select count(*)::int from public.seller_subscriptions s
    where s.plan_version <> (select version from public.plans where id = s.plan_id)),
  0,
  'plan_version agrees with the referenced plan row'
);

-- The creator program keys themselves.
select is(
  (select count(*)::int from public.plans
    where active and not (entitlements ? 'creatorProgram' and entitlements ? 'creatorPartnerships')),
  0,
  'every active plan declares both creator entitlement keys'
);

select is(
  (select array_agg(code order by code)::text from public.plans
    where active and (entitlements->>'creatorProgram')::boolean),
  '{growth,scale}',
  'the creator program is a paid feature'
);

select * from finish();
rollback;
