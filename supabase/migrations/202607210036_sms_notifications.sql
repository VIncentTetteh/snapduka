-- supabase/migrations/202607210036_sms_notifications.sql
-- Adds SMS as a fourth deliverable notification channel (alongside
-- email/whatsapp/push), using the same consent-based gate already applied
-- to buyer WhatsApp updates: only sent when the seller opted in and the
-- buyer gave marketing consent and left a phone number.

alter table public.notification_preferences
  add column order_sms boolean not null default false;

alter table public.notifications drop constraint notifications_channel_check;
alter table public.notifications add constraint notifications_channel_check
  check(channel in ('email','whatsapp','push','sms','in_app'));

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
