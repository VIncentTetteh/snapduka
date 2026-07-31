-- Per-order settlement records, the delivery timestamp the hold depends on, and
-- the per-country payout policy.
--
-- order_settlements is what makes a refund computable months later. It snapshots
-- the fee rate and hold length that applied AT CAPTURE, so lowering the platform
-- fee never retroactively changes what an old order owed — the same discipline
-- as creator_commissions.rate_bps and order_lines.snapshot.
--
-- It is also the idempotency anchor for capture: unique(order_id) means a second
-- attempt to settle the same order cannot insert, whichever caller arrives.

create table public.order_settlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_attempt_id uuid references public.payment_attempts(id),
  seller_account_id uuid not null references public.seller_accounts(id) on delete restrict,
  currency public.currency_code not null,

  gross_minor bigint not null check (gross_minor > 0),
  -- Snapshots. Never re-read from country_configs when reversing.
  platform_fee_bps integer not null check (platform_fee_bps between 0 and 10000),
  hold_days smallint not null check (hold_days between 0 and 90),

  platform_fee_minor bigint not null check (platform_fee_minor >= 0),
  -- Defined as the remainder of gross, never rounded independently, so the two
  -- shares always reconstruct the total exactly.
  seller_gross_minor bigint not null check (seller_gross_minor >= 0),
  psp_fee_minor bigint not null default 0 check (psp_fee_minor >= 0),

  -- Running position of this order's seller share, so a partial refund knows
  -- how much is still held versus already released.
  pending_minor bigint not null check (pending_minor >= 0),
  released_minor bigint not null default 0 check (released_minor >= 0),
  clawed_back_minor bigint not null default 0 check (clawed_back_minor >= 0),

  status text not null default 'pending'
    check (status in ('pending', 'released', 'reversed')),
  -- NULL until the order is delivered; the hold cannot start before then.
  release_at timestamptz,
  released_at timestamptz,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint order_settlements_order_key unique (order_id),
  constraint order_settlements_split_check
    check (seller_gross_minor + platform_fee_minor = gross_minor)
);

create index order_settlements_seller_idx
  on public.order_settlements (seller_account_id, captured_at desc);
-- Drives the release worker's scan.
create index order_settlements_release_idx
  on public.order_settlements (release_at)
  where status = 'pending';

create trigger order_settlements_updated
  before update on public.order_settlements
  for each row execute function public.set_updated_at();

alter table public.order_settlements enable row level security;
alter table public.order_settlements force row level security;

create policy order_settlements_owner_operator_read on public.order_settlements
for select to authenticated using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

grant select on public.order_settlements to authenticated;
grant all on public.order_settlements to service_role;

-- ---------------------------------------------------------------------------
-- Delivery timestamp
-- ---------------------------------------------------------------------------

-- The hold is "delivered plus N days", and there was no delivered-at anywhere:
-- fulfillment_status carries the state but not when it was reached.
alter table public.orders add column fulfilled_at timestamptz;

comment on column public.orders.fulfilled_at is
  'When the order was first completed or fulfilled. Starts the payout hold window. Set by trigger, never by application code.';

/**
 * Stamps fulfilled_at and starts the hold clock.
 *
 * A trigger rather than application code because the two paths that complete an
 * order disagree about which column they touch: updateOrderAction sets
 * fulfillment_status, while bulkOrderStatusAction sets only status. Capturing
 * this in either handler would silently miss the other, which is the same
 * reasoning that put creator commission accrual on a trigger.
 *
 * Only the FIRST transition counts — a re-completed order must not restart a
 * hold that has already run.
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

create trigger orders_stamp_fulfilled_at
  before update of status, fulfillment_status on public.orders
  for each row execute function public.stamp_order_fulfilled_at();

-- ---------------------------------------------------------------------------
-- Per-country payout policy
-- ---------------------------------------------------------------------------

-- These were constants in src/lib/payouts/balance.ts. Moving them here gives one
-- source of truth, so the TypeScript validator and the SQL that actually moves
-- money cannot drift apart — and fixes minimumPayoutMinor returning 5000 for
-- both GHS and XOF, which is GH₵50 in one currency and ~100x that in the other,
-- since XOF has no minor unit.
alter table public.country_configs
  add column payout_hold_days smallint not null default 3
    check (payout_hold_days between 0 and 90),
  add column payout_fee_minor bigint not null default 100
    check (payout_fee_minor >= 0),
  add column minimum_payout_minor bigint not null default 5000
    check (minimum_payout_minor > 0),
  add column payout_auto_approve_max_minor bigint not null default 100000
    check (payout_auto_approve_max_minor >= 0),
  add column payout_daily_cap_minor bigint
    check (payout_daily_cap_minor is null or payout_daily_cap_minor > 0),
  -- Withdrawals stay off until a real transfer has been proven end to end.
  add column payouts_enabled boolean not null default false,
  -- The cutover switch. 'subaccount' keeps today's split behaviour; 'ledger'
  -- collects into the main account. Data, not code, so the change is one row
  -- update per market and reversible by one more.
  add column settlement_mode text not null default 'subaccount'
    check (settlement_mode in ('subaccount', 'ledger'));

comment on column public.country_configs.settlement_mode is
  'subaccount = Paystack splits at charge time to the seller subaccount (legacy). ledger = the full amount lands in SnapDuka''s main account and the seller is credited in the internal ledger.';
comment on column public.country_configs.payout_auto_approve_max_minor is
  'Withdrawals at or below this fire without operator review. Above it they queue in /admin/payouts.';
comment on column public.country_configs.payouts_enabled is
  'Platform kill switch for withdrawals in this market. Also flipped off automatically when reconciliation detects drift.';

-- XOF has no minor unit, so the shared 5000 default would have meant a ~100x
-- higher threshold there than in GHS. Values chosen to be roughly equivalent.
update public.country_configs
set minimum_payout_minor = 50,
    payout_fee_minor = 5,
    payout_auto_approve_max_minor = 1000
where currency = 'XOF';
