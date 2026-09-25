-- SnapDuka Protect: how held money enters, waits and leaves the ledger.
--
-- The rule this migration enforces everywhere: for a protected order, only
-- delivery confirmation (or its timeout) may start the settlement clock. A
-- seller marking the order complete — from the dashboard, the app, the public
-- API or a bulk action — is a claim, not evidence, and before this migration
-- that claim alone set release_at (stamp_order_fulfilled_at, 202607310059).

-- ---------------------------------------------------------------------------
-- Fee
-- ---------------------------------------------------------------------------

/** The buyer-paid Protect fee for an order total in a country. Mirrors packages/core/src/protect/fee.ts. */
create or replace function public.protect_fee_for(p_amount_minor bigint, p_country public.country_code)
returns bigint
language sql
stable
set search_path = ''
as $$
  select least(
           greatest((p_amount_minor * cc.protect_fee_bps) / 10000, cc.protect_fee_min_minor),
           cc.protect_fee_cap_minor)
    from public.country_configs cc
   where cc.country = p_country;
$$;

revoke all on function public.protect_fee_for(bigint, public.country_code) from public, anon;
grant execute on function public.protect_fee_for(bigint, public.country_code) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Opting an order in or out (buyer, at checkout, before paying)
-- ---------------------------------------------------------------------------

/**
 * Turns Protect on or off for an unpaid order and reprices it.
 *
 * Refused once any payment attempt exists: Paystack was initialised for the old
 * total, and apply_paystack_success rejects a payment whose amount differs from
 * total_minor — so repricing after initialisation would let a buyer be charged
 * for an order that then never becomes paid.
 *
 * Holding money requires the seller to be on ledger settlement; under the
 * legacy subaccount split Paystack pays the seller directly and there is
 * nothing to hold.
 */
create or replace function public.set_order_protection(
  p_order_id uuid,
  p_tracking_token uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  o public.orders%rowtype;
  v_country public.country_code;
  cfg public.country_configs%rowtype;
  v_base bigint;
  v_fee bigint := 0;
  v_held bigint;
begin
  select * into o from public.orders
   where id = p_order_id and tracking_token = p_tracking_token
   for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Order not found.';
  end if;
  if o.payment_method <> 'paystack' or o.payment_status not in ('unpaid', 'pending') then
    raise exception using errcode = '55000', message = 'Protect is only available before paying online.';
  end if;
  if exists (select 1 from public.payment_attempts pa
              where pa.order_id = o.id and pa.status in ('pending', 'paid')) then
    raise exception using errcode = '55000',
      message = 'Payment has already started for this order. Protect cannot be changed now.';
  end if;

  v_base := o.total_minor - o.protect_fee_minor;

  if p_enabled then
    select sa.country into v_country from public.seller_accounts sa where sa.id = o.seller_account_id;
    select * into cfg from public.country_configs where country = v_country;
    if not cfg.protect_enabled then
      raise exception using errcode = '55000', message = 'Protect is not available in this market yet.';
    end if;
    if public.seller_settlement_mode(o.seller_account_id) <> 'ledger' then
      raise exception using errcode = '55000', message = 'This shop does not offer Protect yet.';
    end if;
    if cfg.protect_max_order_minor is not null and v_base > cfg.protect_max_order_minor then
      raise exception using errcode = '55000', message = 'This order is above the Protect limit.';
    end if;
    v_fee := public.protect_fee_for(v_base, v_country);
    if cfg.protect_float_cap_minor is not null then
      select coalesce(sum(st.pending_minor), 0) into v_held
        from public.order_settlements st
        join public.order_protections p on p.order_id = st.order_id
       where st.currency = o.currency and st.status = 'pending'
         and p.state in ('held', 'in_transit', 'releasable', 'disputed');
      if v_held + v_base > cfg.protect_float_cap_minor then
        raise exception using errcode = '55000',
          message = 'Protect is at capacity right now. You can still pay without it.';
      end if;
    end if;
  end if;

  update public.orders
     set protection_mode = case when p_enabled then 'protect' else 'none' end,
         protect_fee_minor = v_fee,
         total_minor = v_base + v_fee,
         event_version = event_version + 1
   where id = o.id;

  return jsonb_build_object(
    'protectionMode', case when p_enabled then 'protect' else 'none' end,
    'protectFeeMinor', v_fee,
    'totalMinor', v_base + v_fee);
end;
$$;

revoke all on function public.set_order_protection(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_order_protection(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Capture
-- ---------------------------------------------------------------------------

/**
 * Same contract as 202607310060, with two changes:
 *
 * - The settlement mode is the seller's effective mode (override, else country),
 *   so a pilot cohort can be on the ledger while the market is not.
 * - A protected order books the Protect fee as SnapDuka revenue, never starts
 *   its hold here (release_at stays NULL until delivery is confirmed), and opens
 *   its order_protections row in the same transaction.
 *
 * The platform fee is charged on goods + delivery only; charging it on the
 * buyer's Protect fee as well would be a fee on a fee.
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
  v_protect boolean;
  v_protect_fee bigint;
  v_platform_fee bigint;
  v_seller_gross bigint;
  v_settlement_id uuid;
  v_psp_fee bigint := greatest(0, coalesce(p_psp_fee_minor, 0));
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then return null; end if;

  -- Only money that actually passed through Paystack lands in our account.
  if o.payment_method <> 'paystack' then return null; end if;

  v_protect := o.protection_mode = 'protect';

  if public.seller_settlement_mode(o.seller_account_id) <> 'ledger' then
    -- Legacy split: Paystack has already paid the seller's subaccount, so there
    -- is nothing to hold. A protected order here means the seller was moved off
    -- the ledger between the buyer opting in and paying; the buyer paid for a
    -- promise nobody can keep, so operators must hear about it.
    if v_protect then
      perform public.emit_domain_event('order', o.id, 'protect.unheld',
        jsonb_build_object('orderId', o.id, 'reason', 'seller_not_on_ledger'),
        'protect.unheld:' || o.id::text);
    end if;
    return null;
  end if;

  select sa.country into v_country
    from public.seller_accounts sa where sa.id = o.seller_account_id;
  select cc.platform_fee_bps, cc.payout_hold_days
    into v_fee_bps, v_hold_days
    from public.country_configs cc where cc.country = v_country;

  v_protect_fee := case when v_protect then o.protect_fee_minor else 0 end;
  -- Fee floors down; the seller's share is the REMAINDER, never independently
  -- rounded, so the parts always reconstruct gross exactly.
  v_platform_fee := ((o.total_minor - v_protect_fee) * v_fee_bps) / 10000;
  v_seller_gross := o.total_minor - v_protect_fee - v_platform_fee;

  insert into public.order_settlements (
    order_id, payment_attempt_id, seller_account_id, currency,
    gross_minor, platform_fee_bps, hold_days,
    platform_fee_minor, seller_gross_minor, psp_fee_minor, protect_fee_minor,
    pending_minor, release_at
  )
  values (
    p_order_id, p_payment_attempt_id, o.seller_account_id, o.currency,
    o.total_minor, v_fee_bps, v_hold_days,
    v_platform_fee, v_seller_gross, v_psp_fee, v_protect_fee,
    v_seller_gross,
    -- Protected orders wait for delivery confirmation. Others keep the old
    -- rule: an order already delivered starts its hold now rather than never.
    case when not v_protect and o.fulfilled_at is not null
         then o.fulfilled_at + (v_hold_days || ' days')::interval end
  )
  on conflict (order_id) do nothing
  returning id into v_settlement_id;

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
      jsonb_build_object('kind', 'platform_revenue', 'amount_minor', -v_platform_fee),
      jsonb_build_object('kind', 'protect_fee_revenue', 'amount_minor', -v_protect_fee)
    ),
    o.seller_account_id,
    p_order_id,
    null, null,
    case when v_protect then 'Online payment captured (Protect)' else 'Online payment captured' end,
    jsonb_build_object('reference', p_reference, 'settlementId', v_settlement_id)
  );

  if v_protect then
    insert into public.order_protections (order_id, seller_account_id, state)
    values (o.id, o.seller_account_id, 'held')
    on conflict (order_id) do nothing;
    perform public.emit_domain_event('order', o.id, 'protect.held',
      jsonb_build_object('orderId', o.id, 'sellerAccountId', o.seller_account_id),
      'protect.held:' || o.id::text);
  end if;

  return v_settlement_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The release gate
-- ---------------------------------------------------------------------------

/**
 * Stamps fulfilled_at and, for ordinary orders, starts the hold — unchanged
 * from 202607310059 except that a protected order never starts its hold here.
 * Its release_at is written by confirm_delivery / protect_sweep instead.
 */
create or replace function public.stamp_order_fulfilled_at()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_hold_days smallint;
begin
  if new.fulfilled_at is not null then return new; end if;
  if new.status <> 'completed' and new.fulfillment_status <> 'fulfilled' then
    return new;
  end if;

  new.fulfilled_at := now();

  if new.protection_mode = 'protect' then
    return new;
  end if;

  select hold_days into v_hold_days
    from public.order_settlements where order_id = new.id;
  if found then
    update public.order_settlements
    set release_at = new.fulfilled_at + (v_hold_days || ' days')::interval
    where order_id = new.id and release_at is null;
  end if;

  return new;
end;
$$;

/**
 * Refuses to mark a protected order fulfilled or completed while its money is
 * still held, unless the change comes from the Protect functions themselves
 * (which set snapduka.protect_release for their own transaction).
 *
 * A database guard rather than a check in each route because there are five
 * ways to complete an order today (dashboard, bulk action, mobile, public API,
 * courier webhook) and the next one will not know about Protect either.
 *
 * Also freezes the Protect terms once payment has started: the fee is part of
 * what the buyer was charged.
 */
create or replace function public.guard_protected_order()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_state public.protect_state;
begin
  if (new.protection_mode is distinct from old.protection_mode
      or new.protect_fee_minor is distinct from old.protect_fee_minor)
     and old.payment_status not in ('unpaid', 'pending') then
    raise exception using errcode = '55000',
      message = 'Protect terms cannot change after payment.';
  end if;

  if new.protection_mode <> 'protect' then return new; end if;
  if coalesce(current_setting('snapduka.protect_release', true), '') = 'on' then return new; end if;

  if (new.fulfillment_status = 'fulfilled' and old.fulfillment_status is distinct from 'fulfilled')
     or (new.status = 'completed' and old.status is distinct from 'completed') then
    select state into v_state from public.order_protections where order_id = new.id;
    if v_state in ('held', 'in_transit', 'disputed') then
      raise exception using errcode = '55000',
        message = 'This order is protected: it completes when the buyer confirms delivery.';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_guard_protected
  before update of status, fulfillment_status, protection_mode, protect_fee_minor on public.orders
  for each row execute function public.guard_protected_order();

-- ---------------------------------------------------------------------------
-- Release
-- ---------------------------------------------------------------------------

/**
 * 202607310060 plus: frozen settlements never release; a protected order
 * releases only from the `releasable` state (its dispute, if any, is tracked on
 * order_protections, where a resolution in the seller's favour legitimately
 * leaves orders.dispute_status = 'resolved'); and a released protected order is
 * marked so on its protection record.
 */
create or replace function public.release_due_order_settlements()
returns integer language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  s record;
  v_released integer := 0;
begin
  for s in
    select st.id, st.order_id, st.seller_account_id, st.currency, st.pending_minor,
           o.protection_mode
    from public.order_settlements st
    join public.orders o on o.id = st.order_id
    left join public.order_protections p on p.order_id = st.order_id
    where st.status = 'pending'
      and st.frozen_at is null
      and st.release_at is not null
      and st.release_at <= now()
      and st.pending_minor > 0
      and o.payment_status = 'paid'
      and o.refund_status = 'none'
      and o.status <> 'cancelled'
      and (
        (o.protection_mode = 'none' and o.dispute_status = 'none')
        or (o.protection_mode = 'protect' and p.state = 'releasable')
      )
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

    if s.protection_mode = 'protect' then
      update public.order_protections
         set state = 'released', released_at = now()
       where order_id = s.order_id and state = 'releasable';
      perform public.emit_domain_event('order', s.order_id, 'protect.released',
        jsonb_build_object('orderId', s.order_id, 'sellerAccountId', s.seller_account_id,
                           'amountMinor', s.pending_minor, 'currency', s.currency),
        'protect.released:' || s.order_id::text);
    end if;

    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger guards for the new seller-owned account
-- ---------------------------------------------------------------------------

/**
 * 202607310058 unchanged except that seller_dispute_reserve joins the accounts
 * that may never go negative: it holds money set aside for a chargeback, and a
 * negative reserve would mean releasing more than was ever reserved.
 */
create or replace function public.post_ledger_transaction(
  p_kind text,
  p_event_key text,
  p_currency public.currency_code,
  p_lines jsonb,
  p_seller_account_id uuid default null,
  p_order_id uuid default null,
  p_payout_request_id uuid default null,
  p_refund_id uuid default null,
  p_reason text default null,
  p_metadata jsonb default '{}'
)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  v_txn_id uuid;
  v_line jsonb;
  v_account_id uuid;
  v_amount bigint;
  v_kind public.ledger_account_kind;
  v_owner uuid;
  v_sum bigint := 0;
  v_balance bigint;
  v_normal public.ledger_normal_balance;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception using errcode = '22023',
      message = 'A ledger transaction needs at least two lines.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sum := v_sum + (v_line->>'amount_minor')::bigint;
  end loop;
  if v_sum <> 0 then
    raise exception using errcode = '23514',
      message = format('Ledger lines do not balance: debits minus credits = %s.', v_sum);
  end if;

  insert into public.ledger_transactions (
    kind, currency, event_key, seller_account_id, order_id,
    payout_request_id, refund_id, reason, metadata
  )
  values (
    p_kind, p_currency, p_event_key, p_seller_account_id, p_order_id,
    p_payout_request_id, p_refund_id, p_reason, coalesce(p_metadata, '{}')
  )
  on conflict (event_key) do nothing
  returning id into v_txn_id;

  if v_txn_id is null then return null; end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_kind := (v_line->>'kind')::public.ledger_account_kind;
    v_owner := nullif(v_line->>'seller_account_id', '')::uuid;
    v_amount := (v_line->>'amount_minor')::bigint;
    if v_amount = 0 then continue; end if;

    v_account_id := public.ledger_account_for(v_kind, p_currency, v_owner);

    select balance_minor, normal_balance into v_balance, v_normal
      from public.ledger_accounts where id = v_account_id for update;
    v_balance := v_balance + (v_amount * (case v_normal when 'debit' then 1 else -1 end));

    if v_kind in ('seller_pending', 'seller_payout_reserved', 'seller_dispute_reserve')
       and v_balance < 0 then
      raise exception using errcode = '23514',
        message = format('%s for seller %s would go negative (%s).', v_kind, v_owner, v_balance);
    end if;

    insert into public.ledger_entries (
      transaction_id, account_id, seller_account_id, currency, amount_minor, balance_after_minor
    )
    values (v_txn_id, v_account_id, v_owner, p_currency, v_amount, v_balance);
  end loop;

  return v_txn_id;
end;
$$;

create or replace function public.check_ledger_invariants()
returns table (check_name text, detail text)
language plpgsql stable security definer set search_path = '' set row_security = off as $$
begin
  return query
  select 'unbalanced_currency',
         format('%s is out by %s', e.currency, sum(e.amount_minor))
  from public.ledger_entries e
  group by e.currency having sum(e.amount_minor) <> 0;

  return query
  select 'balance_cache_drift',
         format('account %s (%s) cached %s, entries say %s',
                a.id, a.kind, a.balance_minor, coalesce(t.total, 0))
  from public.ledger_accounts a
  left join (
    select account_id,
           sum(amount_minor * (case when le.kind = 'debit' then 1 else -1 end)) as total
    from (
      select e.account_id, e.amount_minor,
             (select normal_balance from public.ledger_accounts x where x.id = e.account_id) as kind
      from public.ledger_entries e
    ) le group by account_id
  ) t on t.account_id = a.id
  where a.balance_minor <> coalesce(t.total, 0);

  return query
  select 'negative_restricted_balance',
         format('%s for seller %s is %s', a.kind, a.owner_seller_account_id, a.balance_minor)
  from public.ledger_accounts a
  where a.kind in ('seller_pending', 'seller_payout_reserved', 'seller_dispute_reserve')
    and a.balance_minor < 0;

  return query
  select 'unbalanced_transaction', format('transaction %s', e.transaction_id)
  from public.ledger_entries e
  group by e.transaction_id
  having sum(e.amount_minor) <> 0 or count(*) < 2;

  return query
  select 'stuck_payout', format('payout %s has been processing since %s', p.reference, p.claimed_at)
  from public.payout_requests p
  where p.status = 'processing' and p.claimed_at < now() - interval '24 hours';

  -- Protect: a protected order whose settlement is releasing without the
  -- protection having reached `releasable` means the release gate was bypassed.
  return query
  select 'protect_release_without_confirmation', format('order %s', st.order_id)
  from public.order_settlements st
  join public.order_protections p on p.order_id = st.order_id
  where st.status = 'released' and p.state not in ('releasable', 'released');
end;
$$;

/**
 * 202607310063 plus: the dispute reserve counts as seller liability, and drift
 * only freezes withdrawals in a market that is fully on the ledger. While a
 * pilot cohort is on the ledger and the rest of the market is not, Paystack's
 * balance also holds the platform's share of every legacy split payment, which
 * the ledger never saw — so a mismatch is expected and freezing on it would
 * halt every pilot seller's withdrawals for nothing. Drift is still recorded.
 */
create or replace function public.record_ledger_reconciliation(
  p_currency public.currency_code,
  p_provider_balance_minor bigint,
  p_freeze_threshold_minor bigint default 1000
)
returns text language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  v_clearing bigint;
  v_liability bigint;
  v_drift bigint;
  v_status text;
  v_invariants jsonb;
  v_enforced boolean;
begin
  select coalesce(sum(balance_minor), 0) into v_clearing
    from public.ledger_accounts
   where kind = 'processor_clearing' and currency = p_currency;

  select coalesce(sum(balance_minor), 0) into v_liability
    from public.ledger_accounts
   where kind in ('seller_pending', 'seller_available', 'seller_payout_reserved', 'seller_dispute_reserve')
     and currency = p_currency;

  select coalesce(jsonb_agg(jsonb_build_object('check', check_name, 'detail', detail)), '[]')
    into v_invariants from public.check_ledger_invariants();

  select bool_and(settlement_mode = 'ledger') into v_enforced
    from public.country_configs where currency = p_currency;

  if p_provider_balance_minor is null then
    v_drift := 0;
    v_status := 'provider_unavailable';
  else
    v_drift := p_provider_balance_minor - v_clearing;
    v_status := case
      when jsonb_array_length(v_invariants) > 0 then 'drift'
      when abs(v_drift) > p_freeze_threshold_minor then 'drift'
      else 'matched' end;
  end if;

  insert into public.ledger_reconciliations (
    currency, provider_balance_minor, ledger_clearing_minor,
    seller_liability_minor, drift_minor, status, detail)
  values (
    p_currency, p_provider_balance_minor, v_clearing,
    v_liability, v_drift, v_status,
    jsonb_build_object(
      'invariants', v_invariants,
      'enforced', coalesce(v_enforced, false),
      'coverage_ratio', case when v_liability > 0
                             then round(v_clearing::numeric / v_liability, 4) else null end));

  -- Broken books freeze everywhere; a balance mismatch freezes only where it
  -- is meaningful (see above).
  if v_status = 'drift'
     and (jsonb_array_length(v_invariants) > 0 or coalesce(v_enforced, false)) then
    update public.country_configs set payouts_enabled = false where currency = p_currency;
  end if;

  return v_status;
end;
$$;
