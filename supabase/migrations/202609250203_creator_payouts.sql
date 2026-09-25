-- Creator withdrawals, on the seller payout machinery.
--
-- A creator's wallet (202609250201/0202) is only useful if the money can leave
-- it. Rather than a parallel creator_payout_* stack, payout_destinations and
-- payout_requests are generalised: each row is owned by exactly one of a
-- seller account or a creator. That keeps ONE disbursement path — the execute
-- worker (/api/internal/payouts/execute), claim_payout_for_transfer, Paystack
-- transfers, the transfer webhook, the stale-claim sweeper, the stuck-payout
-- invariant and the operator approval queue — instead of two copies of the
-- part of the system where a bug sends real money to the wrong place.
--
-- What is reused unchanged: claim_payout_for_transfer, record_payout_transfer,
-- release_payout_claim, the worker, the webhook route. What is creator-specific:
-- request_creator_payout (the creator's wallet, locked, instead of the
-- seller's), reserve_creator_payout_destination (creator eligibility instead of
-- seller verification) and the read RPCs. apply_paystack_transfer_event and
-- activate_payout_destination become owner-aware; their seller behaviour is
-- unchanged line for line.
--
-- Standard daily batch only, like a seller's standard withdrawal. No instant
-- creator payouts: instant is priced and risk-gated on seller signals (trust
-- score, KYC) that creators do not have.

-- ---------------------------------------------------------------------------
-- Destinations
-- ---------------------------------------------------------------------------

alter table public.payout_destinations
  add column creator_id uuid references public.creators (id) on delete cascade,
  alter column seller_account_id drop not null,
  add constraint payout_destinations_owner_check
    check ((seller_account_id is null) <> (creator_id is null));

create unique index payout_destinations_creator_one_active_idx
  on public.payout_destinations (creator_id, currency)
  where status = 'active' and creator_id is not null;
create index payout_destinations_creator_idx
  on public.payout_destinations (creator_id, created_at desc)
  where creator_id is not null;

create policy payout_destinations_creator_read on public.payout_destinations
for select to authenticated using (creator_id = (select public.current_creator_id()));

-- Column grant, like the seller one: recipient_code stays unreadable.
grant select (creator_id) on public.payout_destinations to authenticated;

/**
 * Phase 1 for a creator. Mirrors reserve_payout_destination, with the
 * creator's own eligibility: an active creator identity. Returns the existing
 * row on a fingerprint match so a retry never mints a second recipient — and
 * refuses if that row is someone else's, which the owner-scoped fingerprint
 * should make impossible but is too important to leave to one layer.
 */
create or replace function public.reserve_creator_payout_destination(
  p_creator_id uuid,
  p_currency public.currency_code,
  p_type text,
  p_bank_code text,
  p_bank_name text,
  p_account_last4 text,
  p_fingerprint text
)
returns table (destination_id uuid, destination_status text)
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  v_status public.creator_status;
  v_existing public.payout_destinations%rowtype;
  v_id uuid;
begin
  select status into v_status from public.creators where id = p_creator_id;
  if v_status is distinct from 'active' then
    raise exception using errcode = '55000',
      message = 'This creator profile cannot receive payouts.';
  end if;

  select * into v_existing from public.payout_destinations
   where provider = 'paystack' and request_fingerprint = p_fingerprint;
  if v_existing.id is not null then
    if v_existing.creator_id is distinct from p_creator_id then
      raise exception using errcode = '42501', message = 'That destination belongs to someone else.';
    end if;
    return query select v_existing.id, v_existing.status;
    return;
  end if;

  insert into public.payout_destinations (
    creator_id, currency, type, bank_code, bank_name, account_last4, request_fingerprint)
  values (p_creator_id, p_currency, p_type, p_bank_code, p_bank_name, p_account_last4, p_fingerprint)
  returning id into v_id;

  return query select v_id, 'pending'::text;
end;
$$;

/**
 * 202607310061 with the "one active destination" revoke scoped to whichever
 * owner the destination has. Unchanged for sellers.
 */
create or replace function public.activate_payout_destination(
  p_destination_id uuid,
  p_recipient_code text,
  p_resolved_account_name text default null
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  d public.payout_destinations%rowtype;
begin
  select * into d from public.payout_destinations where id = p_destination_id for update;
  if d.id is null then return false; end if;
  if d.status = 'active' then return true; end if;
  if d.status = 'revoked' then return false; end if;

  update public.payout_destinations
  set status = 'revoked', revoked_at = now()
  where currency = d.currency
    and status = 'active'
    and id <> d.id
    and ((d.seller_account_id is not null and seller_account_id = d.seller_account_id)
         or (d.creator_id is not null and creator_id = d.creator_id));

  update public.payout_destinations
  set status = 'active',
      recipient_code = p_recipient_code,
      resolved_account_name = p_resolved_account_name,
      activated_at = now()
  where id = p_destination_id;

  return true;
end;
$$;

/**
 * The caller's own active destinations, one per currency, with the 24-hour
 * cool-off computed on the database clock (request_creator_payout enforces the
 * same window with the same clock). An RPC for the same reason as
 * seller_payout_destination: recipient_code must stay unreadable.
 */
create or replace function public.creator_payout_destination()
returns table (
  currency public.currency_code,
  bank_name text,
  account_last4 text,
  destination_type text,
  resolved_account_name text,
  cooling_off boolean
)
language sql stable security definer set search_path = '' as $$
  select d.currency, d.bank_name, d.account_last4, d.type, d.resolved_account_name,
         (d.activated_at is not null and d.activated_at > now() - interval '24 hours')
    from public.payout_destinations d
   where d.creator_id = (select public.current_creator_id())
     and d.creator_id is not null
     and d.status = 'active'
   order by d.currency;
$$;

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

alter table public.payout_requests
  add column creator_id uuid references public.creators (id) on delete restrict,
  alter column seller_account_id drop not null,
  add constraint payout_requests_owner_check
    check ((seller_account_id is null) <> (creator_id is null));

create index payout_requests_creator_idx
  on public.payout_requests (creator_id, created_at desc)
  where creator_id is not null;

create policy payout_requests_creator_read on public.payout_requests
for select to authenticated using (creator_id = (select public.current_creator_id()));

/**
 * A creator asks to withdraw. request_seller_payout's rules, on the creator's
 * wallet: reserved at request time under a lock on creator_available, one open
 * withdrawal at a time, the 24-hour cool-off after a destination change, the
 * market's minimum, fee, auto-approve ceiling and daily cap, and the platform
 * kill switch. Standard speed only: it goes out in the next 09:00 GMT batch.
 *
 * Withdraws in the currency of the creator's own country, which is the only
 * currency a destination can be set up in. A creator's balance in another
 * market's currency is held and shown but cannot yet be withdrawn.
 */
create or replace function public.request_creator_payout(
  p_amount_minor bigint,
  p_idempotency_key text default null
)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  v_creator uuid := (select public.current_creator_id());
  creator_record public.creators%rowtype;
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
  if v_creator is null then
    raise exception using errcode = '42501', message = 'Sign in as a creator.';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.payout_requests
     where idempotency_key = p_idempotency_key and creator_id = v_creator;
    if v_existing is not null then return v_existing; end if;
  end if;

  select * into creator_record from public.creators where id = v_creator;
  select * into cfg from public.country_configs where country = creator_record.country;
  if cfg.country is null or not cfg.payouts_enabled then
    raise exception using errcode = '55000',
      message = 'Withdrawals are temporarily unavailable. Your balance is safe.';
  end if;

  select * into dest from public.payout_destinations
   where creator_id = v_creator and currency = cfg.currency and status = 'active';
  if dest.id is null then
    raise exception using errcode = '55000',
      message = 'Add a payout destination before withdrawing.';
  end if;
  -- "Change the bank details, withdraw everything" is the canonical
  -- account-takeover sequence; a creator account is as takeover-able as a
  -- seller's.
  if dest.activated_at > now() - interval '24 hours' then
    raise exception using errcode = '55000',
      message = 'New payout details take 24 hours to activate. This protects your account.';
  end if;

  if exists (
    select 1 from public.payout_requests
     where creator_id = v_creator
       and status in ('requested', 'approved', 'processing')) then
    raise exception using errcode = '55000',
      message = 'You already have a withdrawal in progress.';
  end if;

  -- The serialisation point: two concurrent requests cannot both read the same
  -- balance and pass.
  v_available_account := public.ledger_account_for_creator('creator_available', cfg.currency, v_creator);
  select balance_minor into v_available
    from public.ledger_accounts where id = v_available_account for update;

  v_fee := cfg.payout_fee_minor;
  if p_amount_minor is null or p_amount_minor < cfg.minimum_payout_minor then
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
     where creator_id = v_creator
       and created_at >= date_trunc('day', now())
       and status <> 'rejected' and status <> 'cancelled' and status <> 'failed';
    if v_today + p_amount_minor > cfg.payout_daily_cap_minor then
      raise exception using errcode = '55000', message = 'That would pass your daily withdrawal limit.';
    end if;
  end if;

  v_not_before := date_trunc('day', now()) + interval '9 hours';
  if v_not_before <= now() then v_not_before := v_not_before + interval '1 day'; end if;

  insert into public.payout_requests (
    creator_id, amount_minor, fee_minor, net_minor, currency,
    status, payout_destination_id, requested_by, idempotency_key,
    destination, speed, not_before
  )
  values (
    v_creator, p_amount_minor, v_fee, p_amount_minor - v_fee, cfg.currency,
    case when p_amount_minor <= cfg.payout_auto_approve_max_minor then 'approved' else 'requested' end,
    dest.id, auth.uid(), p_idempotency_key,
    jsonb_build_object('bankName', dest.bank_name, 'last4', dest.account_last4, 'type', dest.type),
    'standard', v_not_before
  )
  returning id into v_payout_id;

  v_txn := public.post_ledger_transaction(
    'payout_reserve',
    'payout_reserve:' || v_payout_id::text,
    cfg.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'creator_available', 'creator_id', v_creator,
                         'amount_minor', p_amount_minor),
      jsonb_build_object('kind', 'creator_payout_reserved', 'creator_id', v_creator,
                         'amount_minor', -p_amount_minor)
    ),
    null, null, v_payout_id, null, 'Creator withdrawal requested');

  update public.payout_requests set reserve_ledger_txn_id = v_txn where id = v_payout_id;
  return v_payout_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settlement, owner-aware
-- ---------------------------------------------------------------------------

/**
 * 202607310062 with the payout owner's accounts chosen from the row: seller_*
 * for a seller payout (identical lines to before), creator_* for a creator
 * payout. The platform side — processor clearing, Paystack's transfer fee,
 * SnapDuka's payout fee — is the same money either way.
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
  v_prefix text;
  v_owner_key text;
  v_owner uuid;
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

  if p.creator_id is not null then
    v_prefix := 'creator'; v_owner_key := 'creator_id'; v_owner := p.creator_id;
  else
    v_prefix := 'seller'; v_owner_key := 'seller_account_id'; v_owner := p.seller_account_id;
  end if;

  if p_status = 'success' and p.status <> 'paid' then
    v_txn := public.post_ledger_transaction(
      'payout_settled', 'payout_settled:' || p.id::text, p.currency,
      jsonb_build_array(
        jsonb_build_object('kind', v_prefix || '_payout_reserved', v_owner_key, v_owner,
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
        jsonb_build_object('kind', v_prefix || '_available', v_owner_key, v_owner,
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
        jsonb_build_object('kind', v_prefix || '_payout_reserved', v_owner_key, v_owner,
                           'amount_minor', p.amount_minor),
        jsonb_build_object('kind', v_prefix || '_available', v_owner_key, v_owner,
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

-- ---------------------------------------------------------------------------
-- A declined withdrawal gives the money back
-- ---------------------------------------------------------------------------

/**
 * When an operator rejects (or anyone cancels) a withdrawal that never reached
 * Paystack, the reservation goes back to available.
 *
 * Before this, rejecting a payout in /admin/payouts only changed its status:
 * the amount stayed in *_payout_reserved for ever, invisible as available and
 * blocking nothing but also never coming back. Only 'requested' and 'approved'
 * rows qualify — once a row is 'processing' or 'needs_operator' a transfer may
 * exist at Paystack, and only the transfer webhook may say what happened to it.
 *
 * Shares the event key with the webhook's failure path ('payout_released:'),
 * so a payout can be released once, whichever way it ends.
 */
create or replace function public.release_declined_payout_reservation()
returns trigger language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  v_prefix text;
  v_owner_key text;
  v_owner uuid;
begin
  if new.status not in ('rejected', 'cancelled')
     or old.status not in ('requested', 'approved')
     or new.reserve_ledger_txn_id is null then
    return new;
  end if;

  if new.creator_id is not null then
    v_prefix := 'creator'; v_owner_key := 'creator_id'; v_owner := new.creator_id;
  else
    v_prefix := 'seller'; v_owner_key := 'seller_account_id'; v_owner := new.seller_account_id;
  end if;

  perform public.post_ledger_transaction(
    'payout_released', 'payout_released:' || new.id::text, new.currency,
    jsonb_build_array(
      jsonb_build_object('kind', v_prefix || '_payout_reserved', v_owner_key, v_owner,
                         'amount_minor', new.amount_minor),
      jsonb_build_object('kind', v_prefix || '_available', v_owner_key, v_owner,
                         'amount_minor', -new.amount_minor)
    ),
    new.seller_account_id, null, new.id, null,
    case new.status when 'rejected' then 'Withdrawal rejected' else 'Withdrawal cancelled' end);

  return new;
end;
$$;

create trigger payout_requests_release_declined
  after update of status on public.payout_requests
  for each row execute function public.release_declined_payout_reservation();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.reserve_creator_payout_destination(uuid, public.currency_code, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_creator_payout_destination(uuid, public.currency_code, text, text, text, text, text)
  to service_role;

revoke all on function public.creator_payout_destination() from public, anon;
grant execute on function public.creator_payout_destination() to authenticated, service_role;

revoke all on function public.request_creator_payout(bigint, text) from public, anon;
grant execute on function public.request_creator_payout(bigint, text) to authenticated, service_role;

revoke all on function public.release_declined_payout_reservation() from public, anon, authenticated;
