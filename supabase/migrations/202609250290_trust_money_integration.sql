-- Integration of the trust-and-money work across squads (2026-09-25).
--
-- Merged onto the latest definitions (202609250201/0202 creator ledger,
-- 202609250221/0222 financial products), not onto the originals:
--
-- 1. partner_clearing is an asset and grows by debit. It defaulted to credit
--    in ledger_account_for, which kept the books balanced but showed partner
--    cash as a negative balance.
-- 2. BNPL captures go to partner_clearing, not processor_clearing. The BNPL
--    partner pays SnapDuka's bank; booking it against Paystack's clearing
--    account would have read as drift in the nightly Paystack reconciliation
--    and frozen every seller's withdrawals in the market.
-- 3. check_ledger_invariants includes the financial-product invariants, so a
--    broken financing sweep or ad budget freezes payouts like any other break.
-- 4. Reconciliation counts financing_payable and ads_prepaid as seller money
--    SnapDuka holds.
-- 5. A BNPL refund is clawed back against partner_clearing too, matching
--    where its capture was booked.

CREATE OR REPLACE FUNCTION public.ledger_account_for(p_kind ledger_account_kind, p_currency currency_code, p_seller_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_normal public.ledger_normal_balance;
begin
  if p_kind in ('creator_pending', 'creator_available', 'creator_payout_reserved') then
    raise exception using errcode = '22023',
      message = format('%s is a creator account; resolve it with ledger_account_for_creator.', p_kind);
  end if;

  select id into v_id from public.ledger_accounts
   where kind = p_kind and currency = p_currency
     and owner_seller_account_id is not distinct from p_seller_account_id
     and owner_creator_id is null;
  if v_id is not null then return v_id; end if;

  -- Assets and expenses grow by debit; liabilities and income grow by credit.
  v_normal := case p_kind
    when 'processor_clearing' then 'debit'
    when 'bank_settlement' then 'debit'
    when 'processor_fees' then 'debit'
    when 'bad_debt' then 'debit'
    -- Asset: money a financing/BNPL partner owes SnapDuka or has paid in.
    when 'partner_clearing' then 'debit'
    else 'credit'
  end;

  insert into public.ledger_accounts (kind, owner_seller_account_id, currency, normal_balance)
  values (p_kind, p_seller_account_id, p_currency, v_normal)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.ledger_accounts
     where kind = p_kind and currency = p_currency
       and owner_seller_account_id is not distinct from p_seller_account_id
       and owner_creator_id is null;
  end if;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.capture_order_settlement(p_order_id uuid, p_payment_attempt_id uuid, p_reference text, p_psp_fee_minor bigint DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
  -- A BNPL partner pays SnapDuka's bank, not its Paystack balance: booking it
  -- to processor_clearing would show as drift against Paystack every night.
  v_clearing_kind text := case
    when (select provider from public.payment_attempts where id = p_payment_attempt_id) = 'bnpl'
      then 'partner_clearing' else 'processor_clearing' end;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then return null; end if;

  -- Only money that actually passed through Paystack lands in our account.
  if o.payment_method <> 'paystack' then return null; end if;

  v_protect := o.protection_mode = 'protect';

  if public.seller_settlement_mode(o.seller_account_id) <> 'ledger' then
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
      jsonb_build_object('kind', v_clearing_kind, 'amount_minor', o.total_minor - v_psp_fee),
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

  -- Creator commission, if this order earned one on the ledger path.
  perform public.post_creator_commission_accrual(c.id)
     from public.creator_commissions c
    where c.order_id = p_order_id and c.settlement = 'ledger';

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
$function$;

CREATE OR REPLACE FUNCTION public.check_ledger_invariants()
 RETURNS TABLE(check_name text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
         format('%s for %s is %s', a.kind,
                coalesce(a.owner_seller_account_id, a.owner_creator_id), a.balance_minor)
  from public.ledger_accounts a
  where a.kind in ('seller_pending', 'seller_payout_reserved', 'seller_dispute_reserve',
                   'creator_pending', 'creator_payout_reserved')
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

  return query
  select 'protect_release_without_confirmation', format('order %s', st.order_id)
  from public.order_settlements st
  join public.order_protections p on p.order_id = st.order_id
  where st.status = 'released' and p.state not in ('releasable', 'released');

  -- Creator pending vs the commissions that say what it holds. Both sides are
  -- aggregated first and full-joined, so an account with no commissions and a
  -- commission with no account both surface.
  return query
  select 'creator_pending_mismatch',
         format('creator %s %s: ledger holds %s, commissions say %s',
                coalesce(acct.creator_id, comm.creator_id), coalesce(acct.currency, comm.currency),
                coalesce(acct.held, 0), coalesce(comm.held, 0))
  from (
    select a.owner_creator_id as creator_id, a.currency, sum(a.balance_minor)::bigint as held
    from public.ledger_accounts a
    where a.kind = 'creator_pending'
    group by a.owner_creator_id, a.currency
  ) acct
  full join (
    select c.creator_id, c.currency, sum(c.ledger_pending_minor)::bigint as held
    from public.creator_commissions c
    where c.settlement = 'ledger'
    group by c.creator_id, c.currency
  ) comm on comm.creator_id = acct.creator_id and comm.currency = acct.currency
  where coalesce(acct.held, 0) <> coalesce(comm.held, 0);

  -- Stock financing and promoted listings keep their own invariants
  -- (202609250222); one entry point means reconciliation freezes on them too.
  return query select * from public.check_financial_product_invariants();
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_ledger_reconciliation(p_currency currency_code, p_provider_balance_minor bigint, p_freeze_threshold_minor bigint DEFAULT 1000)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
   where kind in ('seller_pending', 'seller_available', 'seller_payout_reserved', 'seller_dispute_reserve',
                  'creator_pending', 'creator_available', 'creator_payout_reserved',
                  -- Seller money SnapDuka still holds in cash: a financing
                  -- repayment awaiting remittance, and an unspent ad budget.
                  'financing_payable', 'ads_prepaid')
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

  if v_status = 'drift'
     and (jsonb_array_length(v_invariants) > 0 or coalesce(v_enforced, false)) then
    update public.country_configs set payouts_enabled = false where currency = p_currency;
  end if;

  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_refund_to_ledger(p_refund_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  r public.refunds%rowtype;
  st public.order_settlements%rowtype;
  v_platform_share bigint;
  v_seller_share bigint;
  v_from_pending bigint;
  v_from_available bigint;
  v_lines jsonb := '[]'::jsonb;
  v_txn uuid;
  -- A BNPL refund goes back through the partner, whose money sits in
  -- partner_clearing (see capture_order_settlement).
  v_clearing_kind text;
begin
  select * into r from public.refunds where id = p_refund_id;
  if r.id is null then return null; end if;
  v_clearing_kind := case
    when (select provider from public.payment_attempts where id = r.payment_attempt_id) = 'bnpl'
      then 'partner_clearing' else 'processor_clearing' end;

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
    'kind', v_clearing_kind, 'amount_minor', -r.amount_minor));

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
$function$;
