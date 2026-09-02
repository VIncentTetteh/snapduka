-- supabase/migrations/202608070068_device_push_tokens.sql
--
-- Native push for the seller app.
--
-- The only push table that existed was `push_subscriptions`, whose shape
-- (endpoint / p256dh / auth) is a W3C Web Push subscription — it cannot hold an
-- Expo token, and nothing ever read it for a seller anyway: the sole reader
-- (api/internal/marketing/process) filters on customer_id. So a seller has
-- never received a push from SnapDuka on any platform.
--
-- Two things are needed: somewhere to keep device tokens, and a fan-out in
-- enqueue_order_notification so an order event actually produces a push row.

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  -- Kept alongside the seller account so a device can be deactivated on sign
  -- out even when the same phone is later used by a different team member.
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  device_id text,
  app_version text,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.device_push_tokens is
  'Expo push tokens for the SnapDuka seller app. Written only by the service role via /api/mobile/v1/devices.';

create index device_push_tokens_seller_active_idx
  on public.device_push_tokens (seller_account_id)
  where active;

alter table public.device_push_tokens enable row level security;
alter table public.device_push_tokens force row level security;

-- Read-only for the owner, so the app can show which devices are registered.
create policy device_push_tokens_owner_read on public.device_push_tokens
  for select to authenticated
  using (
    seller_account_id = public.current_seller_account_id()
    or public.is_operator()
  );

-- Deliberately no insert/update/delete for `authenticated`, mirroring
-- 202607210041_push_subscriptions_service_role_only.sql. That migration exists
-- because an open insert policy let anyone attach their own device to another
-- seller's account and receive their order notifications. Registration goes
-- through the API route, which knows who the caller is.
revoke all on public.device_push_tokens from public, anon, authenticated;
grant select on public.device_push_tokens to authenticated;
grant all on public.device_push_tokens to service_role;

-- Fan a seller push row out per active device, alongside the existing in_app
-- row. Body is carried forward verbatim from 202607210036_sms_notifications.sql
-- with only the push block added.
create or replace function public.enqueue_order_notification(p_order_id uuid, p_event text)
returns void language plpgsql security definer set search_path='' set row_security=off as $$
declare
  o public.orders%rowtype;
  prefs public.notification_preferences%rowtype;
  seller_email text;
  buyer_phone text;
  buyer_consent boolean;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null then return; end if;

  select * into prefs from public.notification_preferences
  where seller_account_id = o.seller_account_id;

  insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
  values(o.id,o.seller_account_id,'email',o.buyer_snapshot->>'email','order_update',
    jsonb_build_object('reference',o.public_reference,'status',p_event,'trackingToken',o.tracking_token));

  insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
  values(o.id,o.seller_account_id,'in_app',o.seller_account_id::text,'seller_order_update',
    jsonb_build_object('reference',o.public_reference,'status',p_event));

  -- One row per registered device. `orderId` is in the payload so tapping the
  -- notification can open the order rather than just the app.
  insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
  select o.id, o.seller_account_id, 'push', d.expo_push_token, 'seller_order_update',
         jsonb_build_object('reference',o.public_reference,'status',p_event,'orderId',o.id)
  from public.device_push_tokens d
  where d.seller_account_id = o.seller_account_id and d.active;

  if prefs.seller_account_id is null or prefs.order_email then
    select contact_email into seller_email from public.seller_accounts where id = o.seller_account_id;
    if seller_email is not null and seller_email <> '' then
      insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
      values(o.id,o.seller_account_id,'email',seller_email,'seller_order_update',
        jsonb_build_object('reference',o.public_reference,'status',p_event));
    end if;
  end if;

  buyer_phone := o.buyer_snapshot->>'phone';
  buyer_consent := coalesce((o.buyer_snapshot->>'marketingConsent')::boolean, false);
  if prefs.seller_account_id is not null and prefs.order_whatsapp
     and buyer_phone is not null and buyer_phone <> '' and buyer_consent then
    insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
    values(o.id,o.seller_account_id,'whatsapp',buyer_phone,'order_update',
      jsonb_build_object('reference',o.public_reference,'status',p_event,'trackingToken',o.tracking_token));
  end if;

  if prefs.seller_account_id is not null and prefs.order_sms
     and buyer_phone is not null and buyer_phone <> '' and buyer_consent then
    insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
    values(o.id,o.seller_account_id,'sms',buyer_phone,'order_update',
      jsonb_build_object('reference',o.public_reference,'status',p_event,'trackingToken',o.tracking_token));
  end if;
end; $$;

-- Grants are re-asserted because create or replace resets them.
revoke execute on function public.enqueue_order_notification(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_order_notification(uuid, text) to service_role;
