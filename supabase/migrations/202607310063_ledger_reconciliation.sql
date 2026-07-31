-- Proof that the books match the money, and a kill switch for when they do not.
--
-- The ledger says what SnapDuka owes; Paystack says what SnapDuka actually
-- holds. A custodian who cannot compare those two numbers is not a custodian,
-- so this records the comparison and freezes withdrawals when it drifts.

create table public.ledger_reconciliations (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  currency public.currency_code not null,
  provider_balance_minor bigint,
  ledger_clearing_minor bigint not null,
  seller_liability_minor bigint not null,
  drift_minor bigint not null,
  status text not null check (status in ('matched', 'drift', 'provider_unavailable')),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object')
);

create index ledger_reconciliations_run_idx
  on public.ledger_reconciliations (currency, run_at desc);

alter table public.ledger_reconciliations enable row level security;
alter table public.ledger_reconciliations force row level security;

create policy ledger_reconciliations_operator_read on public.ledger_reconciliations
for select to authenticated using ((select public.is_operator()));

grant select on public.ledger_reconciliations to authenticated;
grant all on public.ledger_reconciliations to service_role;

/**
 * Internal checks that need no provider call, so they run even when Paystack is
 * unreachable. Returns one row per problem; an empty result is a healthy ledger.
 */
create or replace function public.check_ledger_invariants()
returns table (check_name text, detail text)
language plpgsql stable security definer set search_path = '' set row_security = off as $$
begin
  -- 1. The books close: for each currency, debits equal credits.
  return query
  select 'unbalanced_currency',
         format('%s is out by %s', e.currency, sum(e.amount_minor))
  from public.ledger_entries e
  group by e.currency having sum(e.amount_minor) <> 0;

  -- 2. The cached balance agrees with the entries it summarises.
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

  -- 3. Money a seller has not been cleared to touch is never negative.
  return query
  select 'negative_restricted_balance',
         format('%s for seller %s is %s', a.kind, a.owner_seller_account_id, a.balance_minor)
  from public.ledger_accounts a
  where a.kind in ('seller_pending', 'seller_payout_reserved') and a.balance_minor < 0;

  -- 4. Every transaction is a real double entry.
  return query
  select 'unbalanced_transaction', format('transaction %s', e.transaction_id)
  from public.ledger_entries e
  group by e.transaction_id
  having sum(e.amount_minor) <> 0 or count(*) < 2;

  -- 5. A payout stuck mid-flight means a transfer whose outcome we never learned.
  return query
  select 'stuck_payout', format('payout %s has been processing since %s', p.reference, p.claimed_at)
  from public.payout_requests p
  where p.status = 'processing' and p.claimed_at < now() - interval '24 hours';
end;
$$;

/**
 * Records one reconciliation run and freezes withdrawals on drift.
 *
 * Freezing is deliberately blunt: if the books and the bank disagree, paying
 * anyone else out makes the problem worse. Nothing here ever auto-corrects —
 * corrections are reversing transactions posted by an operator, which the
 * immutability trigger enforces anyway.
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
begin
  select coalesce(sum(balance_minor), 0) into v_clearing
    from public.ledger_accounts
   where kind = 'processor_clearing' and currency = p_currency;

  select coalesce(sum(balance_minor), 0) into v_liability
    from public.ledger_accounts
   where kind in ('seller_pending', 'seller_available', 'seller_payout_reserved')
     and currency = p_currency;

  select coalesce(jsonb_agg(jsonb_build_object('check', check_name, 'detail', detail)), '[]')
    into v_invariants from public.check_ledger_invariants();

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
      -- Below 1.0 means SnapDuka is holding less than it owes.
      'coverage_ratio', case when v_liability > 0
                             then round(v_clearing::numeric / v_liability, 4) else null end));

  if v_status = 'drift' then
    update public.country_configs set payouts_enabled = false where currency = p_currency;
  end if;

  return v_status;
end;
$$;

revoke all on function public.check_ledger_invariants() from public, anon, authenticated;
grant execute on function public.check_ledger_invariants() to service_role;
revoke all on function public.record_ledger_reconciliation(public.currency_code, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.record_ledger_reconciliation(public.currency_code, bigint, bigint)
  to service_role;
