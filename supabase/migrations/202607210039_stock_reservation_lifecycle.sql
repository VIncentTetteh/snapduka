-- supabase/migrations/202607210039_stock_reservation_lifecycle.sql
-- reserve_product_stock creates a stock_reservations row on every checkout
-- attempt, but nothing ever called finish_stock_reservation to consume or
-- release it — every abandoned cart or failed payment permanently locked
-- that quantity out of availability math, and reservations never actually
-- expired in practice even though they carry an expires_at.

create or replace function public.finalize_order_stock(p_order_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  reservation_id_var uuid;
begin
  if p_outcome not in ('consumed', 'released') then
    raise exception using errcode = '22023', message = 'Invalid stock finalization outcome.';
  end if;

  for reservation_id_var in
    select id from public.stock_reservations
    where reference like 'order:' || p_order_id::text || ':%' and status = 'active'
  loop
    perform public.finish_stock_reservation(reservation_id_var, p_outcome);
  end loop;
end;
$$;

grant execute on function public.finalize_order_stock(uuid, text) to service_role;

-- Finalize stock the moment a Paystack payment actually succeeds — this is
-- the same reference pattern create_guest_order uses when it reserves
-- stock ('order:<order_id>:<product_id>:<variant_id|base>'), so no new
-- column or link table is needed to find an order's reservations.
create or replace function public.apply_paystack_success(p_reference text,p_event_key text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $$
declare attempt public.payment_attempts%rowtype; order_record public.orders%rowtype;
begin
  insert into public.provider_events(provider,event_key,event_type,payload)
  values('paystack',p_event_key,'charge.success',p_payload) on conflict(provider,event_key) do nothing;
  if not found then return false; end if;
  select * into attempt from public.payment_attempts where reference=p_reference for update;
  if attempt.id is null then return false; end if;
  select * into order_record from public.orders where id=attempt.order_id for update;
  if (p_payload#>>'{data,status}') <> 'success'
    or (p_payload#>>'{data,amount}')::bigint <> order_record.total_minor
    or (p_payload#>>'{data,currency}') <> order_record.currency::text then
    update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
    return false;
  end if;
  update public.payment_attempts set status='paid',provider_data=p_payload->'data' where id=attempt.id;
  update public.orders set payment_status='paid',status=case when status='pending' then 'confirmed' else status end,event_version=event_version+1 where id=attempt.order_id;
  perform public.finalize_order_stock(attempt.order_id, 'consumed');
  insert into public.financial_events(order_id,event_type,amount_minor,currency,data)
  values(attempt.order_id,'payment_succeeded',order_record.total_minor,order_record.currency,jsonb_build_object('reference',p_reference));
  insert into public.order_events(order_id,seller_account_id,event_type,actor_type,data)
  values(attempt.order_id,attempt.seller_account_id,'payment_succeeded','provider',jsonb_build_object('reference',p_reference));
  update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
  return true;
end; $$;
