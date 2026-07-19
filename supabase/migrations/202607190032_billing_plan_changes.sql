-- supabase/migrations/202607190032_billing_plan_changes.sql
-- Scheduled plan changes: a downgrade or cancellation now takes effect at
-- the end of the current paid period instead of revoking entitlements
-- immediately, matching what the billing page has always told sellers.
--
-- Also tightens seller_subscriptions writes to the service-role admin
-- client only. The existing owner insert/update policies
-- (202606130012_branding_domains.sql) let any authenticated seller set
-- arbitrary state/period values directly via Supabase's REST API — RLS
-- only checks row ownership, not values — bypassing Paystack checkout
-- entirely. All subscription writes now go through server actions using
-- createAdminClient(), which enforce real payment verification.

alter table public.seller_subscriptions
  add column pending_plan_id uuid references public.plans (id),
  add column pending_plan_version integer,
  add column pending_price_id uuid references public.plan_prices (id),
  add column pending_change_type text check (pending_change_type in ('downgrade', 'cancel')),
  add column provider_authorization_code text,
  add constraint seller_subscriptions_pending_shape_check check (
    (pending_change_type is null
      and pending_plan_id is null and pending_plan_version is null and pending_price_id is null)
    or (pending_change_type = 'cancel'
      and pending_plan_id is null and pending_plan_version is null and pending_price_id is null)
    or (pending_change_type = 'downgrade'
      and pending_plan_id is not null and pending_plan_version is not null and pending_price_id is not null)
  );

create index seller_subscriptions_pending_period_idx
  on public.seller_subscriptions (current_period_end)
  where pending_change_type is not null;

drop policy subscriptions_owner_insert on public.seller_subscriptions;
drop policy subscriptions_owner_update on public.seller_subscriptions;
revoke insert, update on public.seller_subscriptions from authenticated;
