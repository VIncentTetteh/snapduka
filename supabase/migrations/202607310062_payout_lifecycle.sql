-- The withdrawal lifecycle: request -> claim -> transfer -> settle.
--
-- Three-phase, mirroring the subaccount reserve/record/activate RPCs, because
-- the failure that matters is a crash between calling Paystack and writing the
-- result. Unlike subaccount creation this one has a clean recovery: the transfer
-- carries our own payout reference, so Paystack can simply be asked what
-- happened, and a retry with the same reference cannot send money twice.

/**
 * A seller asks to withdraw.
 *
 * Reserves the money at REQUEST time rather than at approval: the displayed
 * available balance becomes honest the instant they ask, and the double-spend
 * window closes entirely. The FOR UPDATE on the wallet row is the serialisation
 * point — two concurrent requests cannot both read the same balance and pass.
 */
create or replace function public.request_seller_payout(
  p_amount_minor bigint,
  p_idempotency_key text default null
)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  v_seller uuid := (select public.current_seller_account_id());
  seller_record public.seller_accounts%rowtype;
  cfg public.country_configs%rowtype;
  dest public.payout_destinations%rowtype;
  v_available_account uuid;
  v_available bigint;
  v_fee bigint;
  v_payout_id uuid;
  v_txn uuid;
  v_today bigint;
  v_existing uuid;
begin
  if v_seller is null then
    raise exception using errcode = '42501', message = 'Sign in as a seller.';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.payout_requests
     where idempotency_key = p_idempotency_key and seller_account_id = v_seller;
    if v_existing is not null then return v_existing; end if;
  end if;

  select * into seller_record from public.seller_accounts where id = v_seller;
  if seller_record.status <> 'active' then
    raise exception using errcode = '55000', message = 'This account cannot withdraw right now.';
  end if;

  select * into cfg from public.country_configs where country = seller_record.country;
  if not cfg.payouts_enabled then
    raise exception using errcode = '55000',
      message = 'Withdrawals are temporarily unavailable. Your balance is safe.';
  end if;

  select * into dest from public.payout_destinations
   where seller_account_id = v_seller and currency = cfg.currency and status = 'active';
  if dest.id is null then
    raise exception using errcode = '55000',
      message = 'Add a payout destination before withdrawing.';
  end if;
  -- Cool-off after a destination change. "Change the bank details, withdraw
  -- everything" is the canonical account-takeover sequence, and this single
  -- delay is the highest-value control in the whole flow.
  if dest.activated_at > now() - interval '24 hours' then
    raise exception using errcode = '55000',
      message = 'New payout details take 24 hours to activate. This protects your account.';
  end if;

  -- One open withdrawal at a time. Simple, correct, and nobody will notice.
  if exists (
    select 1 from public.payout_requests
     where seller_account_id = v_seller
       and status in ('requested', 'approved', 'processing')) then
    raise exception using errcode = '55000',
      message = 'You already have a withdrawal in progress.';
  end if;

  v_available_account := public.ledger_account_for('seller_available', cfg.currency, v_seller);
  select balance_minor into v_available
    from public.ledger_accounts where id = v_available_account for update;

  v_fee := cfg.payout_fee_minor;
  if p_amount_minor < cfg.minimum_payout_minor then
    raise exception using errcode = '55000',
      message = format('The smallest withdrawal is %s.', cfg.minimum_payout_minor);
  end if;
  if p_amount_minor <= v_fee then
    raise exception using errcode = '55000', message = 'Amount must be more than the withdrawal fee.';
  end if;
  if p_amount_minor > v_available then
    raise exception using errcode = '55000', message = 'That is more than your available balance.';
  end if;

  if cfg.payout_daily_cap_minor is not null then
    select coalesce(sum(amount_minor), 0) into v_today
      from public.payout_requests
     where seller_account_id = v_seller
       and created_at >= date_trunc('day', now())
       and status <> 'rejected' and status <> 'cancelled' and status <> 'failed';
    if v_today + p_amount_minor > cfg.payout_daily_cap_minor then
      raise exception using errcode = '55000', message = 'That would pass your daily withdrawal limit.';
    end if;
  end if;

  insert into public.payout_requests (
    seller_account_id, amount_minor, fee_minor, net_minor, currency,
    status, payout_destination_id, requested_by, idempotency_key,
    destination
  )
  values (
    v_seller, p_amount_minor, v_fee, p_amount_minor - v_fee, cfg.currency,
    case when p_amount_minor <= cfg.payout_auto_approve_max_minor then 'approved' else 'requested' end,
    dest.id, auth.uid(), p_idempotency_key,
    jsonb_build_object('bankName', dest.bank_name, 'last4', dest.account_last4, 'type', dest.type)
  )
  returning id into v_payout_id;

  -- Reserved in the SAME transaction as the request, so there is no moment
  -- where the seller could ask twice against one balance.
  v_txn := public.post_ledger_transaction(
    'payout_reserve',
    'payout_reserve:' || v_payout_id::text,
    cfg.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'seller_available', 'seller_account_id', v_seller,
                         'amount_minor', p_amount_minor),
      jsonb_build_object('kind', 'seller_payout_reserved', 'seller_account_id', v_seller,
                         'amount_minor', -p_amount_minor)
    ),
    v_seller, null, v_payout_id, null, 'Withdrawal requested');

  update public.payout_requests set reserve_ledger_txn_id = v_txn where id = v_payout_id;
  return v_payout_id;
end;
$$;

revoke all on function public.request_seller_payout(bigint, text) from public, anon;
grant execute on function public.request_seller_payout(bigint, text) to authenticated, service_role;

/**
 * Phase 1 of execution: take exclusive ownership of an approved payout.
 * A conditional update, so a second worker gets zero rows and moves on.
 */
create or replace function public.claim_payout_for_transfer(p_payout_id uuid)
returns table (
  payout_id uuid, reference text, net_minor bigint,
  currency public.currency_code, recipient_code text
)
language plpgsql security definer set search_path = '' set row_security = off as $$
begin
  return query
  with claimed as (
    update public.payout_requests p
    set status = 'processing', claimed_at = now(), updated_at = now()
    where p.id = p_payout_id and p.status = 'approved'
    returning p.id, p.reference, p.net_minor, p.currency, p.payout_destination_id
  )
  select c.id, c.reference, c.net_minor, c.currency, d.recipient_code
  from claimed c join public.payout_destinations d on d.id = c.payout_destination_id;
end;
$$;

/**
 * Phase 3: record what the provider said. Deliberately posts NO ledger entries —
 * a 'pending' transfer is not evidence money moved, and Ghanaian bank and mobile
 * money transfers fail asynchronously all the time. Only the webhook settles.
 */
create or replace function public.record_payout_transfer(
  p_payout_id uuid, p_transfer_code text, p_transfer_id text, p_provider_status text
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off as $$
begin
  update public.payout_requests
  set provider_transfer_code = p_transfer_code,
      provider_transfer_id = p_transfer_id,
      status = case when p_provider_status = 'otp' then 'needs_operator' else status end,
      updated_at = now()
  where id = p_payout_id and status = 'processing';
  return found;
end;
$$;

/** Returns a claimed payout to the queue when the provider call failed outright. */
create or replace function public.release_payout_claim(p_payout_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' set row_security = off as $$
begin
  update public.payout_requests
  set status = 'approved', claimed_at = null, failure_reason = p_reason, updated_at = now()
  where id = p_payout_id and status = 'processing' and provider_transfer_code is null;
  return found;
end;
$$;

/**
 * Settles a transfer from the webhook.
 *
 * Looks up by OUR reference rather than the provider's transfer code, because
 * the code may be missing if we crashed between the Paystack call and phase 3 —
 * the reference is set before the call and is always present.
 */
create or replace function public.apply_paystack_transfer_event(
  p_event_key text, p_reference text, p_transfer_id text,
  p_status text, p_payload jsonb
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  p public.payout_requests%rowtype;
  v_transfer_fee bigint := coalesce(nullif(p_payload#>>'{data,fee}', '')::bigint, 0);
  v_txn uuid;
begin
  insert into public.provider_events (provider, event_key, event_type, payload)
  values ('paystack', p_event_key, 'transfer_event', p_payload)
  on conflict (provider, event_key) do nothing;
  if not found then return false; end if;

  select * into p from public.payout_requests where reference = p_reference for update;
  -- Paystack sends transfer events for anything on the integration, including
  -- activity that did not originate here.
  if p.id is null then
    update public.provider_events set processed_at = now()
     where provider = 'paystack' and event_key = p_event_key;
    return false;
  end if;

  if p_status = 'success' and p.status <> 'paid' then
    v_txn := public.post_ledger_transaction(
      'payout_settled', 'payout_settled:' || p.id::text, p.currency,
      jsonb_build_array(
        jsonb_build_object('kind', 'seller_payout_reserved', 'seller_account_id', p.seller_account_id,
                           'amount_minor', p.amount_minor),
        jsonb_build_object('kind', 'processor_fees', 'amount_minor', v_transfer_fee),
        jsonb_build_object('kind', 'processor_clearing',
                           'amount_minor', -(p.net_minor + v_transfer_fee)),
        jsonb_build_object('kind', 'payout_fee_revenue', 'amount_minor', -p.fee_minor)
      ),
      p.seller_account_id, null, p.id, null, 'Transfer confirmed by Paystack');

    update public.payout_requests
    set status = 'paid', paid_at = now(), settle_ledger_txn_id = v_txn,
        provider_transfer_id = coalesce(p_transfer_id, provider_transfer_id), updated_at = now()
    where id = p.id;

  elsif p_status in ('failed', 'reversed') and p.status = 'paid' then
    -- Reversed after we had already booked a success: unwind the settlement and
    -- return the money to available, not to reserved — the payout is over.
    v_txn := public.post_ledger_transaction(
      'payout_reversed', 'payout_reversed:' || p.id::text, p.currency,
      jsonb_build_array(
        jsonb_build_object('kind', 'processor_clearing',
                           'amount_minor', p.net_minor + v_transfer_fee),
        jsonb_build_object('kind', 'payout_fee_revenue', 'amount_minor', p.fee_minor),
        jsonb_build_object('kind', 'processor_fees', 'amount_minor', -v_transfer_fee),
        jsonb_build_object('kind', 'seller_available', 'seller_account_id', p.seller_account_id,
                           'amount_minor', -p.amount_minor)
      ),
      p.seller_account_id, null, p.id, null, 'Transfer reversed after settlement');

    update public.payout_requests
    set status = 'reversed', failure_reason = coalesce(p_payload#>>'{data,reason}', 'Reversed by provider'),
        updated_at = now()
    where id = p.id;

  elsif p_status in ('failed', 'reversed') then
    -- Never settled: give the reservation straight back.
    v_txn := public.post_ledger_transaction(
      'payout_released', 'payout_released:' || p.id::text, p.currency,
      jsonb_build_array(
        jsonb_build_object('kind', 'seller_payout_reserved', 'seller_account_id', p.seller_account_id,
                           'amount_minor', p.amount_minor),
        jsonb_build_object('kind', 'seller_available', 'seller_account_id', p.seller_account_id,
                           'amount_minor', -p.amount_minor)
      ),
      p.seller_account_id, null, p.id, null, 'Transfer failed');

    update public.payout_requests
    set status = 'failed', failure_reason = coalesce(p_payload#>>'{data,reason}', 'Transfer failed'),
        updated_at = now()
    where id = p.id;
  end if;

  update public.provider_events set processed_at = now()
   where provider = 'paystack' and event_key = p_event_key;
  return true;
end;
$$;

revoke all on function public.claim_payout_for_transfer(uuid) from public, anon, authenticated;
grant execute on function public.claim_payout_for_transfer(uuid) to service_role;
revoke all on function public.record_payout_transfer(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_payout_transfer(uuid, text, text, text) to service_role;
revoke all on function public.release_payout_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.release_payout_claim(uuid, text) to service_role;
revoke all on function public.apply_paystack_transfer_event(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_paystack_transfer_event(text, text, text, text, jsonb) to service_role;
