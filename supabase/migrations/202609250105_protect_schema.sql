-- SnapDuka Protect: schema.
--
-- Protect holds a buyer's payment until delivery is confirmed — by the buyer's
-- one-time delivery code, the buyer tapping "I received it", or a timeout — and
-- only then starts the seller's settlement hold. It is the product's answer to
-- the commonest failure of social commerce in Ghana: "I paid and they blocked
-- me". It rides entirely on the existing ledger (202607310058-0064); nothing
-- here moves money on its own.
--
-- This migration adds the data model. The functions follow in 0106-0108.

-- ---------------------------------------------------------------------------
-- Per-seller settlement cutover
-- ---------------------------------------------------------------------------

-- settlement_mode was per country, so moving to the ledger meant moving a whole
-- market at once with no way back for one seller. A per-seller override lets a
-- pilot cohort move first and lets any single seller be moved back by updating
-- one row. NULL means "follow the country".
alter table public.seller_accounts
  add column settlement_mode_override text
    check (settlement_mode_override in ('subaccount', 'ledger'));

comment on column public.seller_accounts.settlement_mode_override is
  'Overrides country_configs.settlement_mode for this seller (pilot cohorts, rollback). NULL follows the country.';

create or replace function public.seller_settlement_mode(p_seller_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sa.settlement_mode_override, cc.settlement_mode, 'subaccount')
    from public.seller_accounts sa
    left join public.country_configs cc on cc.country = sa.country
   where sa.id = p_seller_account_id;
$$;

revoke all on function public.seller_settlement_mode(uuid) from public, anon;
grant execute on function public.seller_settlement_mode(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Per-country Protect policy
-- ---------------------------------------------------------------------------

alter table public.country_configs
  -- Kill switch per market, in addition to the `protect` feature flag. Off by
  -- default: holding buyer funds is gated on a legal opinion (Bank of Ghana,
  -- Payment Systems and Services Act 2019, Act 987) per market.
  add column protect_enabled boolean not null default false,
  -- The buyer-paid fee. Basis points of goods + delivery, clamped to a floor and
  -- a cap so it is never trivially small nor absurd on a large order.
  add column protect_fee_bps integer not null default 150
    check (protect_fee_bps between 0 and 1000),
  add column protect_fee_min_minor bigint not null default 100
    check (protect_fee_min_minor >= 0),
  add column protect_fee_cap_minor bigint not null default 2000
    check (protect_fee_cap_minor >= 0),
  -- After delivery confirmation the buyer has this long to report a problem
  -- before the ordinary settlement hold begins.
  add column protect_inspection_hours smallint not null default 24
    check (protect_inspection_hours between 0 and 336),
  -- With no confirmation at all, funds move on after this long from dispatch.
  add column protect_auto_release_hours smallint not null default 168
    check (protect_auto_release_hours between 24 and 1440),
  -- A courier's own "delivered" report shortens the wait to this.
  add column protect_courier_release_hours smallint not null default 72
    check (protect_courier_release_hours between 1 and 1440),
  -- Paid but not dispatched after this long: flagged for operator follow-up.
  add column protect_dispatch_sla_hours smallint not null default 72
    check (protect_dispatch_sla_hours between 1 and 720),
  -- Pilot guard rails until the legal opinion lands: largest single protected
  -- order, and total money held under Protect at once. NULL means no limit.
  add column protect_max_order_minor bigint
    check (protect_max_order_minor is null or protect_max_order_minor > 0),
  add column protect_float_cap_minor bigint
    check (protect_float_cap_minor is null or protect_float_cap_minor > 0),
  -- Instant withdrawal pricing (standard next-day withdrawals keep the flat
  -- payout_fee_minor).
  add column instant_payout_fee_bps integer not null default 100
    check (instant_payout_fee_bps between 0 and 1000),
  add column instant_payout_fee_min_minor bigint not null default 100
    check (instant_payout_fee_min_minor >= 0);

-- Conservative pilot limits for Ghana: GH₵2,000 per order, GH₵50,000 held.
update public.country_configs
   set protect_max_order_minor = 200000,
       protect_float_cap_minor = 5000000
 where country = 'GH';

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

alter table public.orders
  add column protection_mode text not null default 'none'
    check (protection_mode in ('none', 'protect')),
  add column protect_fee_minor bigint not null default 0
    check (protect_fee_minor >= 0),
  add constraint orders_protect_fee_mode_check
    check (protection_mode = 'protect' or protect_fee_minor = 0);

-- The buyer pays the Protect fee, so it is part of what Paystack charges and
-- therefore part of total_minor, which apply_paystack_success compares against
-- the amount paid.
alter table public.orders drop constraint orders_totals_check;
alter table public.orders add constraint orders_totals_check check (
  subtotal_minor >= 0
  and discount_minor between 0 and subtotal_minor
  and delivery_minor >= 0
  and total_minor = subtotal_minor - discount_minor + delivery_minor + protect_fee_minor
);

-- ---------------------------------------------------------------------------
-- Settlements
-- ---------------------------------------------------------------------------

alter table public.order_settlements
  add column protect_fee_minor bigint not null default 0 check (protect_fee_minor >= 0),
  -- A frozen settlement never releases, whatever its release_at says. Set by an
  -- open Protect dispute or card chargeback.
  add column frozen_at timestamptz,
  add column frozen_reason text;

alter table public.order_settlements drop constraint order_settlements_split_check;
alter table public.order_settlements add constraint order_settlements_split_check
  check (seller_gross_minor + platform_fee_minor + protect_fee_minor = gross_minor);

-- ---------------------------------------------------------------------------
-- Ledger: the seller-owned dispute reserve
-- ---------------------------------------------------------------------------

alter table public.ledger_accounts drop constraint ledger_accounts_owner_check;
alter table public.ledger_accounts add constraint ledger_accounts_owner_check check (
  (kind in ('seller_pending', 'seller_available', 'seller_payout_reserved', 'seller_dispute_reserve'))
    = (owner_seller_account_id is not null)
);

-- ---------------------------------------------------------------------------
-- The protection record
-- ---------------------------------------------------------------------------

create table public.order_protections (
  order_id uuid primary key references public.orders (id) on delete restrict,
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  state public.protect_state not null default 'held',
  -- bcrypt hash of the buyer's current delivery code. The plaintext exists only
  -- inside the outbox event that delivers it to the buyer, and is redacted from
  -- there once sent. Sellers never see it: this table is service-role only.
  delivery_code_hash text,
  code_issued_at timestamptz,
  code_attempts smallint not null default 0,
  code_locked_until timestamptz,
  -- Unguessable handle for the courier's "enter delivery code" page. Not the
  -- buyer's tracking token, which also opens disputes and support.
  rider_token uuid not null default gen_random_uuid(),
  held_at timestamptz not null default now(),
  dispatched_at timestamptz,
  courier_delivered_at timestamptz,
  delivery_confirmed_at timestamptz,
  confirmation_method text
    check (confirmation_method in ('buyer_code', 'rider_code', 'buyer_tap', 'auto', 'operator')),
  auto_release_at timestamptz,
  inspection_ends_at timestamptz,
  released_at timestamptz,
  dispatch_overdue_at timestamptz,
  disputed_at timestamptz,
  -- Where a dispute found the order, so a dispute resolved for the seller can
  -- put it back exactly there.
  state_before_dispute public.protect_state,
  resolution_note text,
  updated_at timestamptz not null default now(),
  constraint order_protections_rider_token_key unique (rider_token)
);

comment on table public.order_protections is
  'SnapDuka Protect state per order. Service-role only: holds the delivery code hash. Seller/buyer views go through the server.';

create index order_protections_in_transit_idx on public.order_protections (auto_release_at)
  where state = 'in_transit';
create index order_protections_held_idx on public.order_protections (held_at)
  where state = 'held' and dispatch_overdue_at is null;
create index order_protections_seller_idx on public.order_protections (seller_account_id, state);

create trigger order_protections_set_updated_at
  before update on public.order_protections
  for each row execute function public.set_updated_at();

alter table public.order_protections enable row level security;
alter table public.order_protections force row level security;
revoke all on public.order_protections from anon, authenticated;
grant select, insert, update on public.order_protections to service_role;
