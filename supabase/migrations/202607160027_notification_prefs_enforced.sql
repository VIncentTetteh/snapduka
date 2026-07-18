-- 1. Read state for the seller's in-app notification inbox.
alter table public.notifications add column if not exists read_at timestamptz;

create index if not exists notifications_inbox_idx
  on public.notifications(seller_account_id, channel, created_at desc);

-- Sellers may mark their own in-app notifications read — nothing else.
grant update (read_at) on public.notifications to authenticated;
create policy notifications_owner_mark_read on public.notifications
for update to authenticated
using (
  channel = 'in_app'
  and seller_account_id = (select public.current_seller_account_id())
)
with check (
  channel = 'in_app'
  and seller_account_id = (select public.current_seller_account_id())
);

-- 2. Honor seller notification preferences at enqueue time:
--    · buyer email stays unconditional (transactional receipt)
--    · seller in-app alert stays unconditional (feeds the bell inbox)
--    · seller EMAIL alert only when order_email is enabled (default on)
--    · buyer WHATSAPP update only when the seller enabled it AND the buyer
--      gave marketing consent and left a phone number (consent-based)
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
end; $$;
