-- Instant withdrawals: free-ish next-day, paid now.
--
-- Standard withdrawals keep the flat payout_fee_minor and go out in a daily
-- batch; instant ones go out as soon as the execute worker runs (every two
-- minutes) for a percentage fee with a floor. The speed is a real product
-- choice for a trader restocking today, and a revenue line for SnapDuka.
--
-- Nobody is on ledger payouts yet (payouts_enabled defaults false and no market
-- has been cut over), so moving standard withdrawals to a daily batch changes
-- nothing for any live seller.

alter table public.payout_requests
  add column speed text not null default 'standard' check (speed in ('standard', 'instant')),
  add column not_before timestamptz;

comment on column public.payout_requests.not_before is
  'Earliest time the execute worker may claim this payout. NULL = immediately (instant).';

create index payout_requests_due_idx on public.payout_requests (not_before)
  where status = 'approved';

create or replace function public.request_seller_payout(
  p_amount_minor bigint,
  p_idempotency_key text,
  p_speed text
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
  v_not_before timestamptz;
begin
  if p_speed not in ('standard', 'instant') then
    raise exception using errcode = '22023', message = 'Speed must be standard or instant.';
  end if;

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
  if p_speed = 'instant' then
    -- Instant is a paid convenience on top of the standard flat fee.
    v_fee := greatest(cfg.payout_fee_minor,
                      cfg.instant_payout_fee_min_minor,
                      (p_amount_minor * cfg.instant_payout_fee_bps) / 10000);
    -- Money that leaves in minutes cannot be clawed back for a chargeback that
    -- lands tomorrow, so instant is only for verified sellers with nothing
    -- disputed or owed.
    if not exists (select 1 from public.seller_verifications
                    where seller_account_id = v_seller and state = 'verified') then
      raise exception using errcode = '55000',
        message = 'Instant withdrawals need a verified account. Standard withdrawal is still available.';
    end if;
    -- Nightly trust score (202609250144). No score yet means "new": instant
    -- money cannot be recalled, so it waits for an established record.
    if not exists (select 1 from public.seller_trust_scores
                    where seller_account_id = v_seller and tier in ('bronze', 'silver', 'gold')) then
      raise exception using errcode = '55000',
        message = 'Instant withdrawals unlock once your shop has an established track record. Standard withdrawal is still available.';
    end if;
    if exists (select 1 from public.payment_disputes
                where seller_account_id = v_seller and status = 'open')
       or exists (select 1 from public.order_protections
                   where seller_account_id = v_seller and state = 'disputed') then
      raise exception using errcode = '55000',
        message = 'Instant withdrawals are paused while a dispute is open. Standard withdrawal is still available.';
    end if;
    v_not_before := null;
  else
    -- Standard withdrawals go out in the next daily batch at 09:00 GMT.
    v_not_before := date_trunc('day', now()) + interval '9 hours';
    if v_not_before <= now() then v_not_before := v_not_before + interval '1 day'; end if;
  end if;
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
    destination, speed, not_before
  )
  values (
    v_seller, p_amount_minor, v_fee, p_amount_minor - v_fee, cfg.currency,
    case when p_amount_minor <= cfg.payout_auto_approve_max_minor then 'approved' else 'requested' end,
    dest.id, auth.uid(), p_idempotency_key,
    jsonb_build_object('bankName', dest.bank_name, 'last4', dest.account_last4, 'type', dest.type),
    p_speed, v_not_before
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

revoke all on function public.request_seller_payout(bigint, text, text) from public, anon;
grant execute on function public.request_seller_payout(bigint, text, text) to authenticated, service_role;

-- The original two-argument form stays for existing callers and means standard.
create or replace function public.request_seller_payout(
  p_amount_minor bigint,
  p_idempotency_key text default null
)
returns uuid language sql security definer set search_path = '' as $$
  select public.request_seller_payout(p_amount_minor, p_idempotency_key, 'standard');
$$;

/** 202607310062 plus the not_before gate: a standard payout waits for its batch. */
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
      and (p.not_before is null or p.not_before <= now())
    returning p.id, p.reference, p.net_minor, p.currency, p.payout_destination_id
  )
  select c.id, c.reference, c.net_minor, c.currency, d.recipient_code
  from claimed c join public.payout_destinations d on d.id = c.payout_destination_id;
end;
$$;
