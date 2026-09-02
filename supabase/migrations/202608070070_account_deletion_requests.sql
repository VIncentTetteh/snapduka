-- supabase/migrations/202608070070_account_deletion_requests.sql
--
-- In-app account deletion.
--
-- App Store guideline 5.1.1(v) requires any app that lets a user create an
-- account to let them start deleting it from inside the app. There was no such
-- path anywhere in SnapDuka, which is a hard rejection.
--
-- Deletion is a request rather than an immediate DROP, deliberately. A seller's
-- orders, ledger entries, payouts and creator commissions are financial records
-- of transactions involving *other* people — buyers who are owed receipts,
-- creators owed commission, a platform with tax obligations. Cascading them
-- away on a tap would destroy the other side of every one of those. What
-- happens immediately is what the seller actually wants and is entitled to:
-- the shop comes down, the account is closed, and nothing further can be sold.
-- Erasure of personal data then follows on the retention schedule, which the
-- app states plainly rather than implying instant vanishing.

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  -- 'requested' -> operator works the retention schedule -> 'completed', or
  -- 'cancelled' if the seller changes their mind inside the grace window.
  status text not null default 'requested'
    check (status in ('requested', 'completed', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  -- One open request per account: a second tap must not create a second row.
  constraint account_deletion_requests_one_open
    exclude (seller_account_id with =) where (status = 'requested')
);

comment on table public.account_deletion_requests is
  'In-app account deletion requests. Written only by the service role via /api/mobile/v1/account/deletion.';

create index account_deletion_requests_status_idx
  on public.account_deletion_requests (status, requested_at);

alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;

-- The seller can see their own request, so the app can show that one is in
-- flight rather than offering to make another.
create policy account_deletion_requests_owner_read on public.account_deletion_requests
  for select to authenticated
  using (
    seller_account_id = public.current_seller_account_id()
    or public.is_operator()
  );

-- No client writes: closing an account also unpublishes the shop and ends
-- partnerships, which are not the seller's rows to change directly.
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;
