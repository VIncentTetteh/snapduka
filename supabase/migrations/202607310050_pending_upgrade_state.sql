-- Lets an upgrade be *pending* rather than applied optimistically.
--
-- changePlan previously upserted the seller straight onto the target plan in
-- state 'trialing' before sending them to Paystack. trialing grants nothing
-- (see ENTITLED_STATES in src/lib/billing/resolve.ts), so a seller who was
-- paying for Growth and merely *clicked* "Upgrade to Scale" lost every paid
-- feature the instant they clicked — before paying anything, and permanently
-- if they abandoned the checkout. The old Paystack subscription had already
-- been disabled too, so it would not renew either.
--
-- Reproduced on the demo account: Growth/active became Scale/trialing, and the
-- creators page immediately showed the Free upsell.
--
-- The fix keeps the live subscription untouched and parks the target in the
-- pending_* columns until payment is confirmed, which is exactly what those
-- columns already do for scheduled downgrades.

alter table public.seller_subscriptions
  drop constraint seller_subscriptions_pending_change_type_check;

alter table public.seller_subscriptions
  add constraint seller_subscriptions_pending_change_type_check
  check (pending_change_type = any (array['downgrade'::text, 'cancel'::text, 'upgrade'::text]));

alter table public.seller_subscriptions
  drop constraint seller_subscriptions_pending_shape_check;

-- 'upgrade' carries the same payload shape as 'downgrade': a fully resolved
-- target plan and price. The difference is purely when it is applied —
-- downgrades wait for current_period_end, upgrades wait for payment.
alter table public.seller_subscriptions
  add constraint seller_subscriptions_pending_shape_check
  check (
    (pending_change_type is null and pending_plan_id is null
      and pending_plan_version is null and pending_price_id is null)
    or (pending_change_type = 'cancel' and pending_plan_id is null
      and pending_plan_version is null and pending_price_id is null)
    or (pending_change_type in ('downgrade', 'upgrade') and pending_plan_id is not null
      and pending_plan_version is not null and pending_price_id is not null)
  );

comment on column public.seller_subscriptions.pending_change_type is
  'downgrade/cancel apply at current_period_end via the apply-plan-changes cron; upgrade applies on confirmed payment via subscription-verify or the webhook. The cron must never touch an upgrade.';
