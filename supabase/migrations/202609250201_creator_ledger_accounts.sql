-- Creator-owned ledger accounts.
--
-- Until now SnapDuka only RECORDED creator commissions: the seller paid the
-- creator off-platform and pressed "mark as paid" (202607290047/0048). For an
-- order whose money actually passed through SnapDuka's pooled account — one
-- with an order_settlements row — that is backwards: SnapDuka is holding the
-- very money the creator is owed, then handing all of it to the seller and
-- trusting the seller to pass the creator's cut on. This migration gives a
-- creator a wallet in the same double-entry ledger, so the creator's cut can be
-- carved out of the seller's settlement at capture and paid out by SnapDuka.
--
-- Nothing here moves money on its own. 202609250202 wires accrual, release and
-- reversal; 202609250203 wires withdrawals.
--
-- Decisions worth stating:
--
--   * A creator owner is its own column (owner_creator_id), not a reuse of
--     owner_seller_account_id. A creator is not a seller account, and pointing a
--     seller FK at a creator id would either fail or, worse, collide with a
--     real seller's id space in every RLS policy that compares that column.
--     Single-column FK only (supabase-composite-fk-breaks-embeds).
--
--   * post_ledger_transaction keeps its exact signature. A line gains an
--     optional `creator_id` key, so every existing caller is untouched, and the
--     transaction row's creator_id is DERIVED from its lines rather than passed
--     — there is no way to post a creator line that the creator cannot later
--     see in their own history.
--
--   * ledger_account_for refuses creator kinds, and ledger_account_for_creator
--     refuses everything else. Without that, ledger_account_for('creator_pending',
--     cur, NULL) would have matched "the account with no seller owner" — which
--     is every creator's account at once.

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------

alter table public.ledger_accounts
  add column owner_creator_id uuid references public.creators (id) on delete restrict;

comment on column public.ledger_accounts.owner_creator_id is
  'Owner of a creator_* account. Exactly the creator kinds carry it; seller and platform accounts never do.';

-- Creator kinds have a creator owner and only creator kinds do. A SEPARATE
-- constraint, deliberately: ledger_accounts_owner_check is the seller-owned
-- list, and other migrations extend it by parsing its kind list and rebuilding
-- it (202609250221 does exactly that for financing_payable/ads_prepaid). Folding
-- the creator clause into it would have its kinds read back as seller-owned.
--
-- With the existing seller check this also forbids an account with both
-- owners: a creator kind with a seller owner fails the seller check, and a
-- seller kind with a creator owner fails this one.
alter table public.ledger_accounts add constraint ledger_accounts_creator_owner_check check (
  (kind in ('creator_pending', 'creator_available', 'creator_payout_reserved'))
    = (owner_creator_id is not null)
);

-- One account per (kind, currency, owner). The old index coalesced only the
-- seller owner, so a second creator's creator_pending would have collided with
-- the first's (both have a NULL seller owner). Rebuilt with both owners.
drop index public.ledger_accounts_identity_idx;
create unique index ledger_accounts_identity_idx on public.ledger_accounts (
  kind, currency,
  coalesce(owner_seller_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(owner_creator_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index ledger_accounts_creator_idx
  on public.ledger_accounts (owner_creator_id, currency)
  where owner_creator_id is not null;

-- Denormalised onto entries for the same reason seller_account_id is: the
-- creator's RLS policy stays a column comparison instead of a join through
-- ledger_accounts on every read of their own history.
alter table public.ledger_entries
  add column creator_id uuid references public.creators (id);
create index ledger_entries_creator_idx
  on public.ledger_entries (creator_id, created_at desc)
  where creator_id is not null;

alter table public.ledger_transactions
  add column creator_id uuid references public.creators (id);
create index ledger_transactions_creator_idx
  on public.ledger_transactions (creator_id, posted_at desc)
  where creator_id is not null;

-- ---------------------------------------------------------------------------
-- Read access
-- ---------------------------------------------------------------------------

-- current_creator_id() resolves only an ACTIVE creator for the caller, so one
-- creator can never read another's rows, and a seller (who has no creator
-- identity for these rows) reads none of them: the seller policies compare
-- owner_seller_account_id / seller_account_id, which are NULL on creator lines.
create policy ledger_accounts_creator_read on public.ledger_accounts
for select to authenticated using (owner_creator_id = (select public.current_creator_id()));

create policy ledger_entries_creator_read on public.ledger_entries
for select to authenticated using (creator_id = (select public.current_creator_id()));

-- A creator_accrual transaction also carries the seller's id (the debit is on
-- the seller's pending), so the seller sees that the row exists in their own
-- history — but only the seller's own entry, never the creator's.
create policy ledger_transactions_creator_read on public.ledger_transactions
for select to authenticated using (creator_id = (select public.current_creator_id()));

-- ---------------------------------------------------------------------------
-- Account resolution
-- ---------------------------------------------------------------------------

/**
 * 202607310058 plus: refuses creator kinds, and only ever matches accounts with
 * no creator owner. See the header for why the refusal matters.
 */
create or replace function public.ledger_account_for(
  p_kind public.ledger_account_kind,
  p_currency public.currency_code,
  p_seller_account_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;

/**
 * Resolves a creator's account, creating it on first use — the creator's wallet
 * appears the instant they are owed something, as a seller's does.
 * All three creator kinds are liabilities, so all are credit-normal.
 */
create or replace function public.ledger_account_for_creator(
  p_kind public.ledger_account_kind,
  p_currency public.currency_code,
  p_creator_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_kind not in ('creator_pending', 'creator_available', 'creator_payout_reserved') then
    raise exception using errcode = '22023',
      message = format('%s is not a creator account.', p_kind);
  end if;
  if p_creator_id is null then
    raise exception using errcode = '22023', message = 'A creator account needs its creator.';
  end if;

  select id into v_id from public.ledger_accounts
   where kind = p_kind and currency = p_currency and owner_creator_id = p_creator_id;
  if v_id is not null then return v_id; end if;

  insert into public.ledger_accounts (kind, owner_creator_id, currency, normal_balance)
  values (p_kind, p_creator_id, p_currency, 'credit')
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.ledger_accounts
     where kind = p_kind and currency = p_currency and owner_creator_id = p_creator_id;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The single writer
-- ---------------------------------------------------------------------------

/**
 * 202609250106 unchanged for every existing caller, plus:
 *
 * - A line may carry `creator_id`. Creator kinds must, and nothing else may, so
 *   a typo cannot silently post a creator's money to a platform account.
 * - creator_pending and creator_payout_reserved join the accounts that may
 *   never go negative. creator_available may, exactly like seller_available:
 *   a refund after the creator withdrew is a real debt that nets off their next
 *   commission.
 * - The transaction's creator_id is derived from its lines (at most one
 *   creator per transaction), so the creator can read every transaction that
 *   touched their wallet.
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
  v_creator uuid;
  v_txn_creator uuid;
  v_creator_count integer;
  v_sum bigint := 0;
  v_balance bigint;
  v_normal public.ledger_normal_balance;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception using errcode = '22023',
      message = 'A ledger transaction needs at least two lines.';
  end if;

  -- Balance and shape before writing anything, so the common failures are
  -- clear messages rather than a deferred constraint error at COMMIT.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sum := v_sum + (v_line->>'amount_minor')::bigint;
    v_kind := (v_line->>'kind')::public.ledger_account_kind;
    v_creator := nullif(v_line->>'creator_id', '')::uuid;
    if (v_kind in ('creator_pending', 'creator_available', 'creator_payout_reserved'))
       <> (v_creator is not null) then
      raise exception using errcode = '22023',
        message = format('Ledger line %s: creator accounts need creator_id, and only they may carry it.', v_kind);
    end if;
    if v_creator is not null and nullif(v_line->>'seller_account_id', '') is not null then
      raise exception using errcode = '22023',
        message = 'A ledger line belongs to a seller or a creator, not both.';
    end if;
  end loop;
  if v_sum <> 0 then
    raise exception using errcode = '23514',
      message = format('Ledger lines do not balance: debits minus credits = %s.', v_sum);
  end if;

  select count(distinct nullif(l->>'creator_id', '')), min(nullif(l->>'creator_id', ''))::uuid
    into v_creator_count, v_txn_creator
    from jsonb_array_elements(p_lines) l;
  if v_creator_count > 1 then
    raise exception using errcode = '22023',
      message = 'A ledger transaction may touch at most one creator.';
  end if;

  insert into public.ledger_transactions (
    kind, currency, event_key, seller_account_id, order_id,
    payout_request_id, refund_id, reason, metadata, creator_id
  )
  values (
    p_kind, p_currency, p_event_key, p_seller_account_id, p_order_id,
    p_payout_request_id, p_refund_id, p_reason, coalesce(p_metadata, '{}'), v_txn_creator
  )
  on conflict (event_key) do nothing
  returning id into v_txn_id;

  -- Already posted. The caller is a replayed webhook or a retried worker.
  if v_txn_id is null then return null; end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_kind := (v_line->>'kind')::public.ledger_account_kind;
    v_owner := nullif(v_line->>'seller_account_id', '')::uuid;
    v_creator := nullif(v_line->>'creator_id', '')::uuid;
    v_amount := (v_line->>'amount_minor')::bigint;
    if v_amount = 0 then continue; end if;

    if v_creator is not null then
      v_account_id := public.ledger_account_for_creator(v_kind, p_currency, v_creator);
    else
      v_account_id := public.ledger_account_for(v_kind, p_currency, v_owner);
    end if;

    -- Lock and read the balance the entry is about to produce, so
    -- balance_after_minor is a true running total rather than a guess.
    select balance_minor, normal_balance into v_balance, v_normal
      from public.ledger_accounts where id = v_account_id for update;
    v_balance := v_balance + (v_amount * (case v_normal when 'debit' then 1 else -1 end));

    -- Money its owner has not been cleared to touch must never go negative;
    -- only the *_available accounts may, and only via a clawback.
    if v_kind in ('seller_pending', 'seller_payout_reserved', 'seller_dispute_reserve',
                  'creator_pending', 'creator_payout_reserved')
       and v_balance < 0 then
      raise exception using errcode = '23514',
        message = format('%s for %s would go negative (%s).',
                         v_kind, coalesce(v_owner, v_creator), v_balance);
    end if;

    insert into public.ledger_entries (
      transaction_id, account_id, seller_account_id, creator_id, currency,
      amount_minor, balance_after_minor
    )
    values (v_txn_id, v_account_id, v_owner, v_creator, p_currency, v_amount, v_balance);
  end loop;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- A creator's wallet
-- ---------------------------------------------------------------------------

/**
 * A creator's balances, one row per currency.
 *
 * Takes no creator id, so there is nothing to forge: it answers only for the
 * caller's own creator identity. An operator may pass one explicitly. A
 * creator partnered with shops in two countries holds a balance in each
 * currency, and those are never added together.
 */
create or replace function public.creator_wallet_balances(p_creator_id uuid default null)
returns table (
  currency public.currency_code,
  pending_minor bigint,
  available_minor bigint,
  reserved_minor bigint,
  in_arrears boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_creator uuid := (select public.current_creator_id());
begin
  if p_creator_id is not null and p_creator_id is distinct from v_creator
     and not (select public.is_operator()) then
    raise exception using errcode = '42501', message = 'Not your wallet.';
  end if;
  v_creator := coalesce(p_creator_id, v_creator);
  if v_creator is null then return; end if;

  return query
  select
    a.currency,
    coalesce(sum(a.balance_minor) filter (where a.kind = 'creator_pending'), 0)::bigint,
    coalesce(sum(a.balance_minor) filter (where a.kind = 'creator_available'), 0)::bigint,
    coalesce(sum(a.balance_minor) filter (where a.kind = 'creator_payout_reserved'), 0)::bigint,
    coalesce(bool_or(a.kind = 'creator_available' and a.balance_minor < 0), false)
  from public.ledger_accounts a
  where a.owner_creator_id = v_creator
  group by a.currency
  order by a.currency;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invariants and reconciliation
-- ---------------------------------------------------------------------------

/**
 * 202609250106 plus: creator liabilities count as liabilities. Money owed to a
 * creator is sitting in the same Paystack balance as money owed to sellers,
 * and a coverage ratio that ignored it would overstate how covered SnapDuka is.
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
   where kind in ('seller_pending', 'seller_available', 'seller_payout_reserved', 'seller_dispute_reserve',
                  'creator_pending', 'creator_available', 'creator_payout_reserved')
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
$$;

-- ---------------------------------------------------------------------------
-- Grants. create-or-replace keeps existing grants on the redefined functions;
-- only the new ones need stating.
-- ---------------------------------------------------------------------------

revoke all on function public.ledger_account_for_creator(public.ledger_account_kind, public.currency_code, uuid)
  from public, anon, authenticated;
grant execute on function public.ledger_account_for_creator(public.ledger_account_kind, public.currency_code, uuid)
  to service_role;

revoke all on function public.creator_wallet_balances(uuid) from public, anon;
grant execute on function public.creator_wallet_balances(uuid) to authenticated, service_role;
