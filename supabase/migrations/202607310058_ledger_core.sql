-- A double-entry ledger, so SnapDuka can hold money and still say exactly whose
-- it is.
--
-- Buyer payments now land whole in SnapDuka's main Paystack account instead of
-- being split to a per-seller subaccount at charge time. That makes SnapDuka a
-- custodian: the money is in one pot and the only record of who owns what is
-- this ledger. It therefore has to be the kind of record you could hand to an
-- auditor, not a balance column somebody increments.
--
-- Design decisions worth stating, because each has a cheaper-looking wrong answer:
--
--   * Real debit/credit with signed amounts. A "value in is positive" scheme
--     does not balance — a charge would credit the seller AND platform revenue
--     AND the clearing account, all positive. Debits are positive here, credits
--     negative, and every transaction sums to zero.
--
--   * Pending / available / reserved are SEPARATE ACCOUNTS, not a status column
--     on entries. A status column would need UPDATE on entries, which destroys
--     append-only; and it turns every balance read into a filtered sum. As
--     accounts, releasing a hold is just another balanced transaction, so
--     "when did this become withdrawable, and why" is a row rather than an
--     overwritten field.
--
--   * balance_minor is materialised but never trusted. It exists mainly so the
--     payout path has A ROW TO LOCK — without it two concurrent withdrawals
--     both read the same balance and both pass. Honesty comes from entries
--     being immutable, the balance being trigger-maintained, and a daily
--     recompute asserting they agree.
--
--   * Zero-sum is enforced by a DEFERRED constraint trigger at COMMIT, not only
--     inside the posting function. A CHECK cannot see sibling rows, and an
--     immediate trigger would fire before the second leg is inserted. Deferred
--     means even a migration or a psql session cannot leave the books unbalanced.
--
-- Money is in integer minor units and rates in basis points, as everywhere else
-- here. Currency is part of account identity and cross-currency postings raise:
-- if FX ever appears it will be two transactions and an explicit FX account, as
-- a loud decision rather than a silent corruption.

create type public.ledger_account_kind as enum (
  'processor_clearing',      -- asset:     funds sitting with Paystack
  'bank_settlement',         -- asset:     Paystack has paid this out to SnapDuka's bank
  'processor_fees',          -- expense:   Paystack's charges, borne by SnapDuka
  'platform_revenue',        -- income:    SnapDuka's platform fee
  'payout_fee_revenue',      -- income:    SnapDuka's flat withdrawal fee
  'bad_debt',                -- expense:   written-off seller deficits
  'seller_pending',          -- liability: owed, still inside the hold window
  'seller_available',        -- liability: owed and withdrawable
  'seller_payout_reserved'   -- liability: owed, committed to a withdrawal in flight
);

create type public.ledger_normal_balance as enum ('debit', 'credit');

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind public.ledger_account_kind not null,
  owner_seller_account_id uuid references public.seller_accounts(id) on delete restrict,
  currency public.currency_code not null,
  normal_balance public.ledger_normal_balance not null,
  -- Natural sign for the account type: a seller owed GH₵100 reads 10000, not -10000.
  balance_minor bigint not null default 0,
  entry_count bigint not null default 0,
  status text not null default 'open' check (status in ('open', 'in_arrears', 'frozen')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Seller accounts have an owner; platform accounts must not.
  constraint ledger_accounts_owner_check check (
    (kind in ('seller_pending', 'seller_available', 'seller_payout_reserved'))
      = (owner_seller_account_id is not null)
  )
);

-- One account per (kind, currency, owner). The coalesce lets a single unique
-- index cover both seller and platform accounts, since NULL owners would
-- otherwise never collide with each other.
create unique index ledger_accounts_identity_idx on public.ledger_accounts (
  kind, currency,
  coalesce(owner_seller_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index ledger_accounts_seller_idx
  on public.ledger_accounts (owner_seller_account_id, currency)
  where owner_seller_account_id is not null;

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*$'),
  currency public.currency_code not null,
  -- The processing gate, same idea as provider_events(provider, event_key):
  -- derive it from the THING (charge_capture:{order_id}), never from the
  -- delivery mechanism, or two callers dedupe against different keys.
  event_key text not null unique,
  seller_account_id uuid references public.seller_accounts(id),
  order_id uuid references public.orders(id),
  payout_request_id uuid references public.payout_requests(id),
  refund_id uuid references public.refunds(id),
  reason text,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  posted_at timestamptz not null default now()
);
create index ledger_transactions_seller_idx
  on public.ledger_transactions (seller_account_id, posted_at desc);
create index ledger_transactions_order_idx on public.ledger_transactions (order_id);
create index ledger_transactions_payout_idx on public.ledger_transactions (payout_request_id);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  -- Denormalised so the seller's RLS policy is a column comparison rather than
  -- a join through two tables on every read of their own wallet history.
  seller_account_id uuid references public.seller_accounts(id),
  currency public.currency_code not null,
  amount_minor bigint not null check (amount_minor <> 0),  -- debit +, credit −
  balance_after_minor bigint not null,
  created_at timestamptz not null default now()
);
create index ledger_entries_txn_idx on public.ledger_entries (transaction_id);
create index ledger_entries_account_idx on public.ledger_entries (account_id, created_at desc);
create index ledger_entries_seller_idx
  on public.ledger_entries (seller_account_id, created_at desc)
  where seller_account_id is not null;

-- Immutability, mirroring prevent_audit_event_mutation. A ledger you can edit
-- is not a ledger; corrections are new balancing transactions.
create or replace function public.prevent_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'Ledger rows are append-only. Post a correcting transaction instead.';
end;
$$;

create trigger ledger_entries_immutable
  before update or delete on public.ledger_entries
  for each row execute function public.prevent_ledger_mutation();

create trigger ledger_transactions_immutable
  before update or delete on public.ledger_transactions
  for each row execute function public.prevent_ledger_mutation();

-- Deferred to COMMIT so the legs of one transaction can be inserted in sequence.
create or replace function public.assert_ledger_transaction_balanced()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_sum bigint;
  v_count int;
  v_currencies int;
begin
  select coalesce(sum(amount_minor), 0), count(*), count(distinct currency)
    into v_sum, v_count, v_currencies
    from public.ledger_entries where transaction_id = new.transaction_id;

  if v_count < 2 then
    raise exception using errcode = '23514',
      message = format('Ledger transaction %s has %s entries; double entry needs at least two.',
                       new.transaction_id, v_count);
  end if;
  if v_sum <> 0 then
    raise exception using errcode = '23514',
      message = format('Ledger transaction %s does not balance: debits minus credits = %s.',
                       new.transaction_id, v_sum);
  end if;
  if v_currencies > 1 then
    raise exception using errcode = '23514',
      message = format('Ledger transaction %s mixes currencies.', new.transaction_id);
  end if;
  return null;
end;
$$;

create constraint trigger ledger_entries_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function public.assert_ledger_transaction_balanced();

-- Maintains the cached balance. The UPDATE also takes the row lock that
-- serialises concurrent withdrawals against the same wallet.
create or replace function public.apply_ledger_entry_to_balance()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_sign int;
begin
  select case normal_balance when 'debit' then 1 else -1 end
    into v_sign from public.ledger_accounts where id = new.account_id;

  update public.ledger_accounts
  set balance_minor = balance_minor + (new.amount_minor * v_sign),
      entry_count = entry_count + 1,
      updated_at = now()
  where id = new.account_id;

  return null;
end;
$$;

create trigger ledger_entries_apply_balance
  after insert on public.ledger_entries
  for each row execute function public.apply_ledger_entry_to_balance();

-- Resolves an account, creating it on first use. Seller wallets appear the
-- instant a seller has money to hold rather than needing an onboarding step —
-- this is what makes the wallet "instant" from the seller's point of view.
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
  select id into v_id from public.ledger_accounts
   where kind = p_kind and currency = p_currency
     and owner_seller_account_id is not distinct from p_seller_account_id;
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
       and owner_seller_account_id is not distinct from p_seller_account_id;
  end if;
  return v_id;
end;
$$;

/**
 * The single writer. Nothing else may insert into ledger_entries.
 *
 * p_lines is a JSON array of {kind, seller_account_id?, amount_minor}, debits
 * positive and credits negative. Returns the transaction id, or NULL when
 * p_event_key has already been posted — callers treat NULL as "already done",
 * matching how the provider_events gate reads.
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

  -- Balance before writing anything, so the common failure is a clear message
  -- rather than a deferred constraint error at COMMIT.
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

  -- Already posted. The caller is a replayed webhook or a retried worker.
  if v_txn_id is null then return null; end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_kind := (v_line->>'kind')::public.ledger_account_kind;
    v_owner := nullif(v_line->>'seller_account_id', '')::uuid;
    v_amount := (v_line->>'amount_minor')::bigint;
    if v_amount = 0 then continue; end if;

    v_account_id := public.ledger_account_for(v_kind, p_currency, v_owner);

    -- Lock and read the balance the entry is about to produce, so
    -- balance_after_minor is a true running total rather than a guess.
    select balance_minor, normal_balance into v_balance, v_normal
      from public.ledger_accounts where id = v_account_id for update;
    v_balance := v_balance + (v_amount * (case v_normal when 'debit' then 1 else -1 end));

    -- Money the seller has not been cleared to touch must never go negative;
    -- only seller_available may, and only via a clawback after a withdrawal.
    if v_kind in ('seller_pending', 'seller_payout_reserved') and v_balance < 0 then
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

/**
 * Reads a seller's wallet without exposing the platform side of the books.
 *
 * security definer bypasses RLS, so this must re-authorise by hand — taking a
 * seller id as a parameter and trusting it would let any signed-in seller read
 * any other seller's balance. The caller must own the account or be an operator.
 */
create or replace function public.seller_wallet_balance(
  p_seller_account_id uuid,
  p_currency public.currency_code
)
returns table (pending_minor bigint, available_minor bigint, reserved_minor bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_seller_account_id is distinct from (select public.current_seller_account_id())
     and not (select public.is_operator()) then
    raise exception using errcode = '42501', message = 'Not your wallet.';
  end if;

  return query
  select
    coalesce(sum(a.balance_minor) filter (where a.kind = 'seller_pending'), 0)::bigint,
    coalesce(sum(a.balance_minor) filter (where a.kind = 'seller_available'), 0)::bigint,
    coalesce(sum(a.balance_minor) filter (where a.kind = 'seller_payout_reserved'), 0)::bigint
  from public.ledger_accounts a
  where a.owner_seller_account_id = p_seller_account_id and a.currency = p_currency;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.ledger_accounts enable row level security;
alter table public.ledger_accounts force row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_transactions force row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_entries force row level security;

create policy ledger_accounts_owner_operator_read on public.ledger_accounts
for select to authenticated using (
  owner_seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy ledger_entries_owner_operator_read on public.ledger_entries
for select to authenticated using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

-- Transactions carry both sides of every movement, including platform revenue,
-- so sellers read their own entries and operators read the whole book.
create policy ledger_transactions_operator_read on public.ledger_transactions
for select to authenticated using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

grant select on public.ledger_accounts, public.ledger_entries, public.ledger_transactions
  to authenticated;

-- Writes go through post_ledger_transaction and nothing else — not even
-- service_role, which the app uses for every admin path. This is the same
-- reasoning as 202607190032 revoking seller writes on seller_subscriptions:
-- RLS checks who you are, not whether the values make sense.
revoke insert, update, delete on public.ledger_accounts from public, anon, authenticated, service_role;
revoke insert, update, delete on public.ledger_entries from public, anon, authenticated, service_role;
revoke insert, update, delete on public.ledger_transactions from public, anon, authenticated, service_role;
grant select on public.ledger_accounts, public.ledger_entries, public.ledger_transactions to service_role;

revoke all on function public.post_ledger_transaction(text, text, public.currency_code, jsonb, uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.post_ledger_transaction(text, text, public.currency_code, jsonb, uuid, uuid, uuid, uuid, text, jsonb) to service_role;

revoke all on function public.ledger_account_for(public.ledger_account_kind, public.currency_code, uuid) from public, anon, authenticated;
grant execute on function public.ledger_account_for(public.ledger_account_kind, public.currency_code, uuid) to service_role;

revoke all on function public.seller_wallet_balance(uuid, public.currency_code) from public, anon;
grant execute on function public.seller_wallet_balance(uuid, public.currency_code) to authenticated, service_role;
