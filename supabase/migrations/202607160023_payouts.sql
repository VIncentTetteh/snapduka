-- Seller payout requests: a ledger overlay on top of Paystack subaccount
-- settlement that models the balance → request → operator review → paid flow.

create table public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  reference text not null unique default ('PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  amount_minor bigint not null check(amount_minor > 0),
  fee_minor bigint not null default 0 check(fee_minor >= 0),
  currency public.currency_code not null,
  status text not null default 'requested'
    check(status in ('requested','approved','rejected','paid')),
  destination jsonb not null default '{}',
  review_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payout_requests_seller_idx
  on public.payout_requests(seller_account_id, created_at desc);
create index payout_requests_status_idx
  on public.payout_requests(status, created_at desc);

alter table public.payout_requests enable row level security;
alter table public.payout_requests force row level security;

create policy payout_requests_owner_operator_read on public.payout_requests
for select to authenticated using(
  seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator())
);

-- Sellers may create their own requests, always in the initial state.
create policy payout_requests_owner_insert on public.payout_requests
for insert to authenticated with check(
  seller_account_id=(select public.current_seller_account_id())
  and status='requested'
);

-- Only operators transition status; a review reason is mandatory.
create policy payout_requests_operator_update on public.payout_requests
for update to authenticated using((select public.is_operator()))
with check(
  (select public.is_operator())
  and status in ('approved','rejected','paid')
  and review_reason is not null
  and length(btrim(review_reason)) > 0
);

grant select, insert on public.payout_requests to authenticated;
grant update on public.payout_requests to authenticated;
grant all on public.payout_requests to service_role;
