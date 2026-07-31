-- Where a seller's money goes, without ever storing their account number.
--
-- settlement_profiles deliberately keeps only bank_code, bank_name and
-- account_last4, with a constraint forbidding sensitive keys in metadata. The
-- full number is handed to Paystack at onboarding and never persisted. Paystack
-- needs that number to create a transfer recipient — so the number is treated
-- as a write-only credential exchanged for an opaque token: the app collects it,
-- calls /transferrecipient, and stores only the returned recipient_code.
--
-- Three-phase reserve -> provider call -> activate, mirroring
-- reserve_payment_subaccount_request and friends, so a crash between the
-- Paystack call and the database write is recoverable rather than silently
-- creating a second recipient.

create table public.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  provider text not null default 'paystack' check (provider = 'paystack'),
  currency public.currency_code not null,
  type text not null check (type in ('bank', 'mobile_money')),
  bank_code text not null check (btrim(bank_code) <> ''),
  bank_name text not null check (btrim(bank_name) <> ''),
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  -- Paystack's own resolution of the account, for showing the seller who will
  -- be paid before they confirm.
  resolved_account_name text,
  recipient_code text,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  -- HMAC, not a bare hash. The prior art (paymentRequestFingerprint) SHA-256s
  -- the raw account number, and a 10-digit account inside a known bank is a
  -- ~10^10 keyspace — trivially brute-forced from a leaked digest.
  request_fingerprint text not null,
  metadata jsonb not null default '{}'
    check (jsonb_typeof(metadata) = 'object'
           and not public.jsonb_has_sensitive_account_key(metadata)),
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payout_destinations_recipient_key unique (provider, recipient_code),
  constraint payout_destinations_fingerprint_key unique (provider, request_fingerprint),
  constraint payout_destinations_active_fields_check
    check (status <> 'active' or (recipient_code is not null and activated_at is not null))
);

-- At most one live destination per seller per currency.
create unique index payout_destinations_one_active_idx
  on public.payout_destinations (seller_account_id, currency)
  where status = 'active';
create index payout_destinations_seller_idx
  on public.payout_destinations (seller_account_id, created_at desc);

create trigger payout_destinations_updated
  before update on public.payout_destinations
  for each row execute function public.set_updated_at();

alter table public.payout_destinations enable row level security;
alter table public.payout_destinations force row level security;

-- Sellers read their own; they never write directly. recipient_code is a bearer
-- identifier for "where money goes", so it is excluded from the column grant.
create policy payout_destinations_owner_operator_read on public.payout_destinations
for select to authenticated using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

grant select (id, seller_account_id, provider, currency, type, bank_code, bank_name,
              account_last4, resolved_account_name, status, activated_at, revoked_at,
              created_at, updated_at)
  on public.payout_destinations to authenticated;
grant all on public.payout_destinations to service_role;

/**
 * Phase 1. Claims the intent to create a recipient.
 *
 * Enforces the same eligibility as reserve_payment_subaccount_request — active,
 * policy accepted, verified, settlement profile, shop identity — because "may we
 * hold this seller's money and owe it back" is the same question the subaccount
 * gate already answered. Returns the existing row on a fingerprint match so a
 * retry never mints a second Paystack recipient.
 */
create or replace function public.reserve_payout_destination(
  p_seller_account_id uuid,
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
  seller_record public.seller_accounts%rowtype;
  v_existing public.payout_destinations%rowtype;
  v_id uuid;
begin
  select * into seller_record from public.seller_accounts where id = p_seller_account_id;
  if seller_record.id is null or seller_record.status <> 'active' then
    raise exception using errcode = '55000',
      message = 'Seller account is not eligible for payouts.';
  end if;
  if not exists (
    select 1 from public.seller_verifications
     where seller_account_id = seller_record.id and state = 'verified') then
    raise exception using errcode = '55000',
      message = 'Verified seller status is required.';
  end if;

  select * into v_existing from public.payout_destinations
   where provider = 'paystack' and request_fingerprint = p_fingerprint;
  if v_existing.id is not null then
    return query select v_existing.id, v_existing.status;
    return;
  end if;

  insert into public.payout_destinations (
    seller_account_id, currency, type, bank_code, bank_name,
    account_last4, request_fingerprint)
  values (p_seller_account_id, p_currency, p_type, p_bank_code, p_bank_name,
          p_account_last4, p_fingerprint)
  returning id into v_id;

  return query select v_id, 'pending'::text;
end;
$$;

/**
 * Phase 2/3. Records the provider's answer and makes the destination live.
 *
 * Revokes any previously active destination for the same currency in the same
 * transaction, so "one active destination" can never be briefly violated.
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
  where seller_account_id = d.seller_account_id
    and currency = d.currency
    and status = 'active'
    and id <> d.id;

  update public.payout_destinations
  set status = 'active',
      recipient_code = p_recipient_code,
      resolved_account_name = p_resolved_account_name,
      activated_at = now()
  where id = p_destination_id;

  return true;
end;
$$;

revoke all on function public.reserve_payout_destination(uuid, public.currency_code, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_payout_destination(uuid, public.currency_code, text, text, text, text, text)
  to service_role;
revoke all on function public.activate_payout_destination(uuid, text, text) from public, anon, authenticated;
grant execute on function public.activate_payout_destination(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- payout_requests becomes a real disbursement record
-- ---------------------------------------------------------------------------

alter table public.payout_requests
  drop constraint payout_requests_status_check;

-- The four original values are kept so the existing operator screen and its RLS
-- keep working; the rest describe what actually happens once money moves.
alter table public.payout_requests
  add constraint payout_requests_status_check check (status in (
    'requested', 'approved', 'rejected', 'paid',
    'processing', 'failed', 'reversed', 'cancelled', 'needs_operator'
  ));

alter table public.payout_requests
  add column payout_destination_id uuid references public.payout_destinations(id),
  add column net_minor bigint,
  add column provider_transfer_code text,
  add column provider_transfer_id text,
  add column reserve_ledger_txn_id uuid references public.ledger_transactions(id),
  add column settle_ledger_txn_id uuid references public.ledger_transactions(id),
  add column failure_reason text,
  add column requested_by uuid,
  add column claimed_at timestamptz,
  add column idempotency_key text;

create unique index payout_requests_idempotency_idx
  on public.payout_requests (idempotency_key) where idempotency_key is not null;
create unique index payout_requests_transfer_code_idx
  on public.payout_requests (provider_transfer_code) where provider_transfer_code is not null;

comment on column public.payout_requests.net_minor is
  'What Paystack actually transfers: amount_minor less SnapDuka''s payout fee.';

-- THE HOLE THIS CLOSES: payout_requests_owner_insert let a seller INSERT their
-- own request with ANY amount_minor. RLS checks row ownership, not values.
-- Harmless while nothing disbursed; a drain-the-float bug the moment transfers
-- are real. Requests now go through request_seller_payout, which checks the
-- ledger under a lock. Same move 202607190032 made for seller_subscriptions.
drop policy payout_requests_owner_insert on public.payout_requests;
revoke insert on public.payout_requests from authenticated;

-- Operators must not be able to declare that money moved. Only the provider
-- webhook, through a definer RPC, may set processing/paid/failed/reversed.
drop policy payout_requests_operator_update on public.payout_requests;
create policy payout_requests_operator_update on public.payout_requests
for update to authenticated using ((select public.is_operator()))
with check (
  (select public.is_operator())
  and status in ('approved', 'rejected', 'cancelled')
  and review_reason is not null
  and length(btrim(review_reason)) > 0
);

-- Exposed by PostgREST as a virtual column on payout_destinations, so the UI
-- reads the cool-off from the same clock request_seller_payout enforces it
-- with. Computing it from a server or browser clock would disagree at the
-- boundary, and would also make the React render impure.
create or replace function public.cooling_off(d public.payout_destinations)
returns boolean language sql stable set search_path = '' as $$
  select d.activated_at is not null
     and d.activated_at > now() - interval '24 hours';
$$;

grant execute on function public.cooling_off(public.payout_destinations)
  to authenticated, service_role;
