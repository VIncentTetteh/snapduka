-- Wires the ledger into the three moments money actually moves: capture,
-- release from hold, and refund.
--
-- All three are inert until a country's settlement_mode is flipped to 'ledger'.
-- capture_order_settlement returns immediately otherwise, so this migration can
-- ship well ahead of the cutover and the existing subaccount flow is untouched.

/**
 * Credits a seller's wallet for a confirmed online payment.
 *
 * Called from apply_paystack_success, INSIDE its provider_events gate, so it
 * inherits that idempotency rather than inventing a second one. It adds its own
 * order-scoped guard on top — order_settlements.order_id is unique — because
 * the webhook and the verify route reach apply_paystack_success under different
 * event keys and only an order-derived key can dedupe across both.
 *
 * Offline orders (cash on delivery, pay on pickup, seller arranged) return
 * early and post NOTHING. That money never reaches SnapDuka; the seller takes
 * it directly. Crediting a wallet for it would be inventing a debt we do not owe.
 */
create or replace function public.capture_order_settlement(
  p_order_id uuid,
  p_payment_attempt_id uuid,
  p_reference text,
  p_psp_fee_minor bigint default 0
)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  o public.orders%rowtype;
  v_country public.country_code;
  v_fee_bps integer;
  v_hold_days smallint;
  v_mode text;
  v_platform_fee bigint;
  v_seller_gross bigint;
  v_settlement_id uuid;
  v_psp_fee bigint := greatest(0, coalesce(p_psp_fee_minor, 0));
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then return null; end if;

  -- Only money that actually passed through Paystack lands in our account.
  if o.payment_method <> 'paystack' then return null; end if;

  select sa.country into v_country
    from public.seller_accounts sa where sa.id = o.seller_account_id;

  select cc.settlement_mode, cc.platform_fee_bps, cc.payout_hold_days
    into v_mode, v_fee_bps, v_hold_days
    from public.country_configs cc where cc.country = v_country;

  -- Legacy split still in force for this market: Paystack has already paid the
  -- seller's subaccount, so there is nothing for SnapDuka to owe.
  if v_mode is distinct from 'ledger' then return null; end if;

  -- Fee floors down; the seller's share is the REMAINDER, never independently
  -- rounded, so the two always reconstruct gross exactly and no fraction leaks.
  v_platform_fee := (o.total_minor * v_fee_bps) / 10000;
  v_seller_gross := o.total_minor - v_platform_fee;

  insert into public.order_settlements (
    order_id, payment_attempt_id, seller_account_id, currency,
    gross_minor, platform_fee_bps, hold_days,
    platform_fee_minor, seller_gross_minor, psp_fee_minor,
    pending_minor,
    -- Already-delivered orders (pay-on-pickup style flows that later switch to
    -- online) start their hold now rather than never.
    release_at
  )
  values (
    p_order_id, p_payment_attempt_id, o.seller_account_id, o.currency,
    o.total_minor, v_fee_bps, v_hold_days,
    v_platform_fee, v_seller_gross, v_psp_fee,
    v_seller_gross,
    case when o.fulfilled_at is not null
         then o.fulfilled_at + (v_hold_days || ' days')::interval end
  )
  on conflict (order_id) do nothing
  returning id into v_settlement_id;

  -- Already settled by the other caller. Not an error — the expected outcome of
  -- the webhook and the verify redirect both arriving.
  if v_settlement_id is null then return null; end if;

  perform public.post_ledger_transaction(
    'charge_capture',
    'charge_capture:' || p_order_id::text,
    o.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'processor_clearing', 'amount_minor', o.total_minor - v_psp_fee),
      jsonb_build_object('kind', 'processor_fees', 'amount_minor', v_psp_fee),
      jsonb_build_object('kind', 'seller_pending', 'seller_account_id', o.seller_account_id,
                         'amount_minor', -v_seller_gross),
      jsonb_build_object('kind', 'platform_revenue', 'amount_minor', -v_platform_fee)
    ),
    o.seller_account_id,
    p_order_id,
    null, null,
    'Online payment captured',
    jsonb_build_object('reference', p_reference, 'settlementId', v_settlement_id)
  );

  return v_settlement_id;
end;
$$;

revoke all on function public.capture_order_settlement(uuid, uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.capture_order_settlement(uuid, uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Capture hook
-- ---------------------------------------------------------------------------

-- Same body as 202607310057 plus the capture call. The psp fee is read from the
-- payload when Paystack supplied it; when it is absent the reconciler books the
-- difference later rather than this transaction being rewritten.
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

  perform public.capture_order_settlement(
    attempt.order_id, attempt.id, p_reference,
    coalesce(nullif(p_payload#>>'{data,fees}', '')::bigint, 0));

  insert into public.financial_events(order_id,event_type,amount_minor,currency,data)
  values(attempt.order_id,'payment_succeeded',order_record.total_minor,order_record.currency,jsonb_build_object('reference',p_reference));
  insert into public.order_events(order_id,seller_account_id,event_type,actor_type,data)
  values(attempt.order_id,attempt.seller_account_id,'payment_succeeded','provider',jsonb_build_object('reference',p_reference));
  update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
  return true;
end; $$;

-- ---------------------------------------------------------------------------
-- Hold release
-- ---------------------------------------------------------------------------

/**
 * Moves settled credits from pending to available once the hold has elapsed.
 *
 * Structurally a copy of release_due_creator_commissions: it re-checks the order
 * at release time rather than trusting the state at capture, so an order that
 * was refunded, disputed or cancelled during the hold never becomes withdrawable.
 * That re-check is the entire point of having a hold.
 *
 * One transaction per settlement, not one batch, so a single bad row cannot
 * poison the whole run.
 */
create or replace function public.release_due_order_settlements()
returns integer language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  s record;
  v_released integer := 0;
begin
  for s in
    select st.id, st.order_id, st.seller_account_id, st.currency, st.pending_minor
    from public.order_settlements st
    join public.orders o on o.id = st.order_id
    where st.status = 'pending'
      and st.release_at is not null
      and st.release_at <= now()
      and st.pending_minor > 0
      and o.payment_status = 'paid'
      and o.refund_status = 'none'
      and o.dispute_status = 'none'
      and o.status <> 'cancelled'
    order by st.release_at
    limit 200
    for update of st skip locked
  loop
    perform public.post_ledger_transaction(
      'hold_release',
      'hold_release:' || s.id::text,
      s.currency,
      jsonb_build_array(
        jsonb_build_object('kind', 'seller_pending', 'seller_account_id', s.seller_account_id,
                           'amount_minor', s.pending_minor),
        jsonb_build_object('kind', 'seller_available', 'seller_account_id', s.seller_account_id,
                           'amount_minor', -s.pending_minor)
      ),
      s.seller_account_id, s.order_id, null, null, 'Hold period elapsed');

    update public.order_settlements
    set status = 'released',
        released_minor = released_minor + s.pending_minor,
        pending_minor = 0,
        released_at = now()
    where id = s.id and status = 'pending';

    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

revoke all on function public.release_due_order_settlements() from public, anon, authenticated;
grant execute on function public.release_due_order_settlements() to service_role;

-- ---------------------------------------------------------------------------
-- Refund
-- ---------------------------------------------------------------------------

/**
 * Claws a completed refund back out of the seller's wallet.
 *
 * Takes from pending first, then available. SnapDuka gives back its platform fee
 * pro-rata — the seller-fair default, and what reverse_creator_commission
 * already does with a commission basis. Paystack does not return its own
 * processing fee, so processor_fees keeps that cost and SnapDuka absorbs it.
 *
 * The fee rate comes from the SNAPSHOT on order_settlements, never from
 * country_configs, so a fee change since capture cannot alter what an old order
 * gives back.
 *
 * If the seller has already withdrawn, seller_available goes negative. That is
 * deliberate: the debt is real, it blocks further withdrawals, and it nets off
 * automatically against the next order that releases.
 */
create or replace function public.apply_refund_to_ledger(p_refund_id uuid)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  r public.refunds%rowtype;
  st public.order_settlements%rowtype;
  v_platform_share bigint;
  v_seller_share bigint;
  v_from_pending bigint;
  v_from_available bigint;
  v_lines jsonb := '[]'::jsonb;
  v_txn uuid;
begin
  select * into r from public.refunds where id = p_refund_id;
  if r.id is null then return null; end if;

  select * into st from public.order_settlements
   where order_id = r.order_id for update;
  -- No settlement means the order was captured under the legacy subaccount
  -- split, so SnapDuka never held this money and has nothing to claw back.
  if st.id is null then return null; end if;

  v_platform_share := (r.amount_minor * st.platform_fee_bps) / 10000;
  v_seller_share := r.amount_minor - v_platform_share;

  v_from_pending := least(v_seller_share, st.pending_minor);
  v_from_available := v_seller_share - v_from_pending;

  if v_from_pending > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'seller_pending', 'seller_account_id', st.seller_account_id,
      'amount_minor', v_from_pending));
  end if;
  if v_from_available > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'seller_available', 'seller_account_id', st.seller_account_id,
      'amount_minor', v_from_available));
  end if;
  if v_platform_share > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'platform_revenue', 'amount_minor', v_platform_share));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'kind', 'processor_clearing', 'amount_minor', -r.amount_minor));

  v_txn := public.post_ledger_transaction(
    'refund_clawback',
    'refund_clawback:' || p_refund_id::text,
    st.currency, v_lines,
    st.seller_account_id, r.order_id, null, p_refund_id,
    'Refund returned to buyer');

  if v_txn is null then return null; end if;

  update public.order_settlements
  set pending_minor = pending_minor - v_from_pending,
      clawed_back_minor = clawed_back_minor + v_seller_share,
      status = case when pending_minor - v_from_pending = 0 and status = 'pending'
                    then 'reversed' else status end
  where id = st.id;

  -- A seller who owes more than they hold is flagged rather than blocked
  -- silently; the payout RPC refuses while this is set, and the next release
  -- clears it automatically.
  update public.ledger_accounts
  set status = case when balance_minor < 0 then 'in_arrears' else 'open' end
  where owner_seller_account_id = st.seller_account_id
    and kind = 'seller_available' and currency = st.currency;

  return v_txn;
end;
$$;

revoke all on function public.apply_refund_to_ledger(uuid) from public, anon, authenticated;
grant execute on function public.apply_refund_to_ledger(uuid) to service_role;

-- Refund hook. Also sets orders.payment_status, which this RPC never did — so
-- 'refunded' and 'partially_refunded' were unreachable enum values, and
-- reverse_creator_commission's `payment_status='refunded'` branch could never
-- fire (it only ever saw refund_status='completed').
create or replace function public.apply_paystack_refund_event(
  p_event_key text, p_provider_refund_id text, p_status text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $$
declare
  refund_record public.refunds%rowtype;
  mapped_status public.refund_status;
  order_total bigint;
  completed_total bigint;
  v_previous public.refund_status;
begin
  insert into public.provider_events(provider,event_key,event_type,payload)
  values('paystack',p_event_key,'refund_event',p_payload)
  on conflict(provider,event_key) do nothing;
  if not found then return false; end if;

  select * into refund_record from public.refunds
   where provider_refund_id = p_provider_refund_id for update;
  if refund_record.id is null then
    update public.provider_events set processed_at=now()
     where provider='paystack' and event_key=p_event_key;
    return false;
  end if;
  v_previous := refund_record.status;

  mapped_status := case p_status
    when 'processed' then 'completed'::public.refund_status
    when 'failed' then 'failed'::public.refund_status
    else 'processing'::public.refund_status end;

  update public.refunds set status = mapped_status, updated_at = now()
   where id = refund_record.id;

  select total_minor into order_total from public.orders
   where id = refund_record.order_id for update;
  select coalesce(sum(amount_minor),0) into completed_total from public.refunds
   where order_id = refund_record.order_id and status = 'completed';

  update public.orders
  set refund_status = case
        when completed_total <= 0 then 'none'::public.refund_status
        when completed_total >= order_total then 'completed'::public.refund_status
        else 'partial'::public.refund_status end,
      payment_status = case
        when completed_total >= order_total then 'refunded'::public.payment_status
        when completed_total > 0 then 'partially_refunded'::public.payment_status
        else payment_status end
  where id = refund_record.order_id;

  -- Only a refund that actually completed moves money, and only on the
  -- transition INTO completed, so a replayed 'processed' event cannot claw back
  -- twice. post_ledger_transaction's event key is the second guard.
  if mapped_status = 'completed' and v_previous is distinct from 'completed' then
    perform public.apply_refund_to_ledger(refund_record.id);
  end if;

  update public.provider_events set processed_at=now()
   where provider='paystack' and event_key=p_event_key;
  return true;
end; $$;
