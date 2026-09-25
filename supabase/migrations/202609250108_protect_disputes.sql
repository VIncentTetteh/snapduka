-- SnapDuka Protect: buyer disputes.
--
-- A buyer already opens a case from the tracking page (support_cases, one per
-- order). For a protected order whose money has not been released, a case about
-- delivery or the item IS a Protect dispute: it must freeze the money at once,
-- whichever route inserted the case. A trigger does that, so the existing
-- support route, a future WhatsApp "report a problem" and an operator opening a
-- case on the buyer's behalf all behave the same.
--
-- Resolution is an explicit operator decision with an outcome — release to the
-- seller or refund the buyer — because the generic case status 'resolved' does
-- not say who won, and the money needs to know.

create or replace function public.open_protect_dispute_from_case()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  p public.order_protections%rowtype;
begin
  if new.reason not in ('item_not_received', 'item_not_as_described', 'refund_request') then
    return new;
  end if;

  select * into p from public.order_protections where order_id = new.order_id for update;
  if p.order_id is null or p.state not in ('held', 'in_transit', 'releasable') then
    return new;
  end if;

  update public.order_protections
     set state = 'disputed',
         state_before_dispute = p.state,
         disputed_at = now()
   where order_id = new.order_id;

  update public.order_settlements
     set frozen_at = now(), frozen_reason = 'protect_dispute'
   where order_id = new.order_id and status = 'pending';

  perform public.emit_domain_event('order', new.order_id, 'protect.disputed',
    jsonb_build_object('orderId', new.order_id, 'caseId', new.id, 'reason', new.reason,
                       'sellerAccountId', new.seller_account_id),
    'protect.disputed:' || new.id::text);
  return new;
end;
$$;

create trigger support_cases_open_protect_dispute
  after insert on public.support_cases
  for each row execute function public.open_protect_dispute_from_case();

/**
 * Operator decision on a Protect dispute.
 *
 * 'release': the seller wins. The order returns to where the dispute found it;
 *   if delivery had not been confirmed, the operator's decision confirms it
 *   (method 'operator'), which starts the inspection-free release.
 * 'refund': the buyer wins. The protection is closed as refunded and a
 *   `protect.refund_requested` event asks the refund path to return the money
 *   through Paystack; the ledger clawback happens when Paystack confirms, via
 *   the existing apply_refund_to_ledger. The settlement stays frozen so nothing
 *   releases in between.
 */
create or replace function public.resolve_protect_dispute(
  p_order_id uuid,
  p_outcome text,
  p_note text,
  p_operator_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  p public.order_protections%rowtype;
  v_seller uuid;
begin
  if p_outcome not in ('release', 'refund') then
    raise exception using errcode = '22023', message = 'Outcome must be release or refund.';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception using errcode = '22023', message = 'Record why before resolving.';
  end if;

  select * into p from public.order_protections where order_id = p_order_id for update;
  if p.order_id is null then return 'not_found'; end if;
  if p.state <> 'disputed' then return 'not_disputed'; end if;
  v_seller := p.seller_account_id;

  if p_outcome = 'release' then
    update public.order_settlements
       set frozen_at = null, frozen_reason = null
     where order_id = p_order_id and frozen_reason = 'protect_dispute';

    if p.state_before_dispute = 'releasable' then
      update public.order_protections
         set state = 'releasable', resolution_note = p_note
       where order_id = p_order_id;
    else
      -- Delivery was never confirmed; the operator's finding confirms it.
      update public.order_protections
         set state = 'in_transit', resolution_note = p_note
       where order_id = p_order_id;
      perform public.protect_mark_delivered(p_order_id, 'operator');
      -- No inspection window: the dispute was the inspection.
      update public.order_settlements set release_at = now()
       where order_id = p_order_id and status = 'pending';
    end if;
  else
    update public.order_protections
       set state = 'refunded', resolution_note = p_note
     where order_id = p_order_id;
    perform public.emit_domain_event('order', p_order_id, 'protect.refund_requested',
      jsonb_build_object('orderId', p_order_id, 'sellerAccountId', v_seller,
                         'operatorUserId', p_operator_user_id),
      'protect.refund_requested:' || p_order_id::text);
  end if;

  update public.support_cases
     set status = 'resolved',
         resolution = format('Protect dispute resolved (%s): %s', p_outcome, p_note)
   where order_id = p_order_id;
  update public.orders set dispute_status = 'resolved' where id = p_order_id;

  insert into public.order_events (order_id, seller_account_id, event_type, actor_type, actor_id, buyer_visible, data)
  values (p_order_id, v_seller, 'protect_dispute_resolved', 'admin', p_operator_user_id, true,
          jsonb_build_object('outcome', p_outcome));

  perform public.emit_domain_event('order', p_order_id, 'protect.dispute_resolved',
    jsonb_build_object('orderId', p_order_id, 'outcome', p_outcome, 'sellerAccountId', v_seller),
    'protect.dispute_resolved:' || p_order_id::text);

  return 'resolved';
end;
$$;

revoke all on function public.resolve_protect_dispute(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_protect_dispute(uuid, text, text, uuid) to service_role;
