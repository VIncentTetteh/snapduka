-- Telling people when SnapDuka has moved their money (2026-09-25 integration).
--
-- 1. Creators on ledger payouts (202609250202) were never told their share had
--    reached their SnapDuka balance: the existing `creator_commission_payable`
--    message says the SELLER is about to pay them, which is wrong once SnapDuka
--    pays. A ledger commission turning `paid` now sends
--    `creator_wallet_available`, deduplicated per commission.
-- 2. Seller financing messages (disbursed / repaid) are sent by an outbox
--    handler in src/lib/financing/notifications.ts; nothing is needed here.

CREATE OR REPLACE FUNCTION public.enqueue_creator_notification(p_creator_id uuid, p_seller_account_id uuid, p_event text, p_shop_name text, p_amount_minor bigint DEFAULT NULL::bigint, p_currency currency_code DEFAULT NULL::currency_code, p_dedupe_key text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  v_email text;
  v_phone text;
  v_status text;
begin
  if p_event not in (
    'creator_partnership_accepted',
    'creator_commission_earned',
    'creator_commission_payable',
    'creator_payment_recorded',
    'creator_wallet_available'
  ) then
    raise exception using errcode = 'P0001', message = 'Unrecognised creator notification event.';
  end if;

  select c.contact_email, c.contact_phone, c.status::text
    into v_email, v_phone, v_status
  from public.creators c
  where c.id = p_creator_id;

  -- A suspended or closed creator is not messaged.
  if v_status is distinct from 'active' then return false; end if;

  if p_dedupe_key is not null and exists (
    select 1 from public.notifications n
    where n.template = p_event
      and n.payload->>'dedupeKey' = p_dedupe_key
  ) then
    -- Already sent for this exact thing; treat as delivered rather than sending
    -- a second copy.
    return true;
  end if;

  -- creators.contact_phone is NOT NULL and contact_email is optional, so SMS is
  -- the channel that always exists — the same order the invitation itself uses.
  insert into public.notifications (seller_account_id, channel, recipient, template, payload)
  values (
    -- Not the recipient: notifications.seller_account_id is NOT NULL and carries
    -- the shop the message is about. A creator has no seller account, and this
    -- column is what scopes the row for the worker and for support.
    p_seller_account_id,
    case when v_email is not null then 'email' else 'sms' end,
    coalesce(v_email, v_phone),
    p_event,
    jsonb_strip_nulls(jsonb_build_object(
      'event', p_event,
      'shopName', p_shop_name,
      'amountMinor', p_amount_minor,
      'currency', p_currency,
      'dedupeKey', p_dedupe_key
    ))
  );

  return true;
end;
$function$;

create or replace function public.notify_creator_wallet_available()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_shop text;
begin
  select s.display_name into v_shop from public.shops s
   where s.seller_account_id = new.seller_account_id order by s.created_at limit 1;
  perform public.enqueue_creator_notification(
    new.creator_id, new.seller_account_id, 'creator_wallet_available',
    coalesce(v_shop, 'A SnapDuka shop'), new.amount_minor, new.currency,
    'wallet:' || new.id::text);
  return new;
end;
$$;

revoke all on function public.notify_creator_wallet_available() from public, anon, authenticated;

create trigger creator_commissions_wallet_available
  after update of status on public.creator_commissions
  for each row
  when (new.status = 'paid' and old.status is distinct from 'paid' and new.settlement = 'ledger')
  execute function public.notify_creator_wallet_available();
