-- supabase/migrations/202607210040_refund_status_reconciliation.sql
-- Refund status was hardcoded to 'processing' at creation (discarding
-- Paystack's own reported status) and never updated afterward — no webhook
-- handler processed refund.* events. The cumulative-refund sum used to
-- block over-refunding counted these permanently-'processing' rows
-- regardless of whether Paystack actually completed them, so a silently
-- failed refund looked "done" forever and could never be retried.

create or replace function public.apply_paystack_refund_event(
  p_event_key text, p_provider_refund_id text, p_status text, p_payload jsonb
)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $$
declare
  refund_record public.refunds%rowtype;
  mapped_status public.refund_status;
  completed_total bigint;
  order_total bigint;
begin
  insert into public.provider_events(provider,event_key,event_type,payload)
  values('paystack',p_event_key,'refund_event',p_payload) on conflict(provider,event_key) do nothing;
  if not found then return false; end if;

  select * into refund_record from public.refunds where provider_refund_id = p_provider_refund_id for update;
  if refund_record.id is null then
    update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
    return false;
  end if;

  mapped_status := case p_status
    when 'processed' then 'completed'::public.refund_status
    when 'failed' then 'failed'::public.refund_status
    else 'processing'::public.refund_status
  end;

  update public.refunds set status = mapped_status, updated_at = now() where id = refund_record.id;

  select total_minor into order_total from public.orders where id = refund_record.order_id for update;
  select coalesce(sum(amount_minor),0) into completed_total from public.refunds where order_id = refund_record.order_id and status = 'completed';

  update public.orders set refund_status = case
    when completed_total <= 0 then 'none'::public.refund_status
    when completed_total >= order_total then 'completed'::public.refund_status
    else 'partial'::public.refund_status
  end where id = refund_record.order_id;

  update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
  return true;
end; $$;

grant execute on function public.apply_paystack_refund_event(text,text,text,jsonb) to service_role;
