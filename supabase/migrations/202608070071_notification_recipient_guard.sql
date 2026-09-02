-- enqueue_order_notification inserted the buyer's email row unconditionally from
-- buyer_snapshot->>'email'. notifications.recipient is NOT NULL, so an order
-- whose snapshot lacks an email aborted the whole function — the seller's own
-- in_app row, every push token and the seller email all went with it, and the
-- caller only saw a generic error. One optional field taking down every channel
-- is not an acceptable failure mode for the seller's only signal that an order
-- moved.
--
-- Guard each recipient-derived insert instead. The seller-email branch already
-- checked for null/empty; the buyer email, WhatsApp and SMS branches now do the
-- same, and push is inherently guarded by the token join.
create or replace function public.enqueue_order_notification(p_order_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  prefs public.notification_preferences%rowtype;
  seller_email text;
  buyer_email text;
  buyer_phone text;
  buyer_consent boolean;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null then return; end if;

  select * into prefs from public.notification_preferences
  where seller_account_id = o.seller_account_id;

  buyer_email := nullif(btrim(coalesce(o.buyer_snapshot->>'email','')),'');
  if buyer_email is not null then
    insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
    values(o.id,o.seller_account_id,'email',buyer_email,'order_update',
      jsonb_build_object('reference',o.public_reference,'status',p_event,'trackingToken',o.tracking_token));
  end if;

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

  buyer_phone := nullif(btrim(coalesce(o.buyer_snapshot->>'phone','')),'');
  buyer_consent := coalesce((o.buyer_snapshot->>'marketingConsent')::boolean, false);
  if prefs.seller_account_id is not null and prefs.order_whatsapp
     and buyer_phone is not null and buyer_consent then
    insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
    values(o.id,o.seller_account_id,'whatsapp',buyer_phone,'order_update',
      jsonb_build_object('reference',o.public_reference,'status',p_event,'trackingToken',o.tracking_token));
  end if;

  if prefs.seller_account_id is not null and prefs.order_sms
     and buyer_phone is not null and buyer_consent then
    insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
    values(o.id,o.seller_account_id,'sms',buyer_phone,'order_update',
      jsonb_build_object('reference',o.public_reference,'status',p_event,'trackingToken',o.tracking_token));
  end if;
end;
$$;

revoke all on function public.enqueue_order_notification(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_order_notification(uuid, text) to service_role;
