-- Closes a double-apply hole in apply_paystack_success before money depends on it.
--
-- The RPC's only idempotency gate is provider_events(provider, event_key), which
-- dedupes a given EVENT — not a given ORDER. It has two callers using different
-- key namespaces for the same payment:
--
--   webhook  src/app/api/payments/paystack/webhook/route.ts  ->  'charge.success:{data.id}'
--   verify   src/app/api/payments/paystack/verify/route.ts   ->  'verify:{reference}'
--
-- Both keys insert cleanly, so the whole body runs twice for one payment: a
-- second financial_events row, a second order_events row, and a second
-- finalize_order_stock('consumed') call. The common ordering makes this likely
-- rather than exotic — verify fires on the browser redirect and the webhook
-- arrives asynchronously moments later.
--
-- It has been invisible because financial_events has no readers anywhere in
-- src/. It stops being invisible the moment a ledger credit hangs off this
-- function: the seller would be paid twice for one order. Production has 0
-- affected orders today, so this lands before the ledger, not after.
--
-- The fix is an order-derived guard rather than another event key: re-entering
-- with an order already marked paid is a no-op that still records the event as
-- processed, so replay stays observable in provider_events.

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

  -- The order-scoped guard. Reached when the other caller already applied this
  -- payment under a different event key. Marking the event processed keeps
  -- "seen and deliberately skipped" distinguishable from "never arrived", which
  -- is the same discipline the validation branch below already follows.
  if order_record.payment_status = 'paid' then
    update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
    return false;
  end if;

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

-- Backstop, independent of the function body: one settlement per order is the
-- invariant the ledger will rely on, and this makes a second attempt fail at the
-- database rather than depending on the guard above being preserved by whoever
-- edits this function next.
create unique index if not exists financial_events_payment_succeeded_order_idx
  on public.financial_events (order_id)
  where event_type = 'payment_succeeded';

-- apply_paystack_refund_event locks `refunds` by provider_refund_id, which had
-- no index and no uniqueness at all — the `select ... for update` was both a
-- sequential scan and nondeterministic when a provider id repeated.
create unique index if not exists refunds_provider_refund_id_key
  on public.refunds (provider_refund_id)
  where provider_refund_id is not null;
