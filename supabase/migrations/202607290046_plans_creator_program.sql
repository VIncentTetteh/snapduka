-- Adds the creatorProgram / creatorPartnerships entitlements.
--
-- plans.entitlements is a whole-object replacement and
-- plans_one_active_version_per_code_idx allows exactly one active version per
-- code, so adding a key means publishing a NEW VERSION of every active plan.
--
-- The only precedent (202607160028_billing_plans.sql) re-versioned Free, which
-- has no prices and no subscribers — so the two consequences below have never
-- been exercised in this database and would fail silently:
--
--   1. plan_prices rows point at the OLD plan_id. Billing resolves
--      `plans where code=X and active` then `plan_prices where plan_id=<that>`,
--      so an uncopied price means "This plan is not available." at checkout for
--      every paying Growth and Scale seller.
--   2. seller_subscriptions.plan_id points at the old version, and
--      getSellerPlan embeds plans!plan_id — so existing subscribers would keep
--      their old entitlements and not receive what they are paying for.
--
-- Written as a loop over whatever is active rather than hardcoded ids, so it
-- stays correct regardless of which versions are live when it runs.

do $$
declare
  old_plan public.plans%rowtype;
  new_plan_id uuid;
  new_entitlements jsonb;
begin
  for old_plan in select * from public.plans where active order by code loop
    new_entitlements := old_plan.entitlements || case old_plan.code
      when 'free'   then '{"creatorProgram": false, "creatorPartnerships": 0}'::jsonb
      when 'growth' then '{"creatorProgram": true,  "creatorPartnerships": 5}'::jsonb
      when 'scale'  then '{"creatorProgram": true,  "creatorPartnerships": 25}'::jsonb
      else '{"creatorProgram": false, "creatorPartnerships": 0}'::jsonb
    end;

    -- Retire first: the partial unique index forbids two active rows per code.
    update public.plans set active = false, updated_at = now() where id = old_plan.id;

    insert into public.plans (code, name, version, entitlements, active)
    values (old_plan.code, old_plan.name, old_plan.version + 1, new_entitlements, true)
    returning id into new_plan_id;

    -- Carry prices across, preserving provider_plan_code so Paystack plan
    -- objects are not recreated and live subscriptions stay attached.
    insert into public.plan_prices
      (plan_id, country, currency, interval, amount_minor, provider, provider_plan_code, active)
    select new_plan_id, country, currency, interval, amount_minor, provider, provider_plan_code, active
    from public.plan_prices where plan_id = old_plan.id;

    -- Repoint price_id first, matching the old price to its twin on the new
    -- plan by the (country, interval) pair it represents. Done before the
    -- plan_id move so it can still key off the old price rows.
    update public.seller_subscriptions s
    set price_id = new_price.id, updated_at = now()
    from public.plan_prices old_price
    join public.plan_prices new_price
      on new_price.plan_id = new_plan_id
     and new_price.country = old_price.country
     and new_price.interval = old_price.interval
    where s.price_id = old_price.id and old_price.plan_id = old_plan.id;

    -- Then move every subscription on this plan to the new version, including
    -- ones with a null price_id that the remap above could not match.
    update public.seller_subscriptions
    set plan_id = new_plan_id, plan_version = old_plan.version + 1, updated_at = now()
    where plan_id = old_plan.id;

    -- Pending downgrades target a plan too; repoint those as well.
    update public.seller_subscriptions
    set pending_plan_id = new_plan_id, pending_plan_version = old_plan.version + 1, updated_at = now()
    where pending_plan_id = old_plan.id;

    update public.plan_prices set active = false where plan_id = old_plan.id;
  end loop;
end $$;
