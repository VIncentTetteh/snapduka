-- Creator program: identity, the seller<->creator relationship, and the
-- commission ledger.
--
-- A creator is a third party who promotes a seller's shop and earns a cut of
-- the sales they drive. Until now SnapDuka had no seat for them — every growth
-- table is keyed on seller_account_id, so an influencer existed only as a URL.
--
-- Settlement is seller-to-creator: SnapDuka computes and records what is owed,
-- the seller pays it directly. Holding third-party funds is an explicit PRD
-- non-goal and would be money transmission in GH/NG.

create type public.creator_status as enum ('active', 'suspended', 'closed');
create type public.partnership_status as enum ('invited', 'active', 'paused', 'ended', 'declined');
create type public.commission_status as enum ('pending', 'payable', 'paid', 'reversed', 'void');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.creators (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  handle text not null unique,
  display_name text not null,
  contact_email text,
  contact_phone text not null,
  country public.country_code not null,
  status public.creator_status not null default 'active',
  -- How the SELLER pays them. Shown to partnered sellers only; SnapDuka never
  -- touches this money, so no full bank details are stored.
  payout_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creators_handle_check check (handle ~ '^[a-z0-9][a-z0-9_]{2,29}$'),
  constraint creators_display_name_check check (btrim(display_name) <> ''),
  constraint creators_contact_email_check check (
    contact_email is null or (contact_email = lower(contact_email) and contact_email like '%@%.%')),
  constraint creators_contact_phone_check check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint creators_payout_details_check check (jsonb_typeof(payout_details) = 'object')
);
create trigger creators_set_updated_at before update on public.creators
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Relationship
-- ---------------------------------------------------------------------------

create table public.creator_partnerships (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  status public.partnership_status not null default 'invited',
  -- Basis points, never a float. The 50% ceiling makes a fat-fingered "500%"
  -- unrepresentable rather than merely unlikely.
  rate_bps integer not null check (rate_bps between 0 and 5000),
  -- Long enough to outlast the refund window, short enough that a creator who
  -- posted this week is paid this month.
  hold_days smallint not null default 14 check (hold_days between 0 and 90),
  currency public.currency_code not null,
  terms_note text,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_partnerships_pair_key unique (seller_account_id, creator_id),
  constraint creator_partnerships_accepted_check
    check (status not in ('active', 'paused') or accepted_at is not null),
  constraint creator_partnerships_ended_check
    check (status not in ('ended', 'declined') or ended_at is not null)
);
create index creator_partnerships_creator_idx on public.creator_partnerships (creator_id, status);
create index creator_partnerships_seller_idx on public.creator_partnerships (seller_account_id, status);
create trigger creator_partnerships_set_updated_at before update on public.creator_partnerships
  for each row execute function public.set_updated_at();

-- A seller must not be able to earn commission on their own orders, directly
-- or through a staff member. Cross-table, so a trigger rather than a check.
create function public.assert_creator_partnership_arms_length() returns trigger
language plpgsql security definer set search_path = '' set row_security = off as $$
declare creator_user uuid;
begin
  select auth_user_id into creator_user from public.creators where id = new.creator_id;
  if exists (select 1 from public.seller_accounts
             where id = new.seller_account_id and auth_user_id = creator_user)
     or exists (select 1 from public.team_memberships
                where seller_account_id = new.seller_account_id
                  and auth_user_id = creator_user and active) then
    raise exception using errcode = '23514',
      message = 'A seller or their team member cannot be their own creator.';
  end if;
  return new;
end; $$;

create trigger creator_partnerships_arms_length
  before insert or update of creator_id, seller_account_id on public.creator_partnerships
  for each row execute function public.assert_creator_partnership_arms_length();

-- Mirrors public.team_invitations: hashed single-use token with an expiry.
create table public.creator_invitations (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  contact text not null,
  contact_kind text not null check (contact_kind in ('email', 'phone')),
  rate_bps integer not null check (rate_bps between 0 and 5000),
  hold_days smallint not null default 14 check (hold_days between 0 and 90),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint creator_invitations_contact_check check (contact = lower(contact)),
  constraint creator_invitations_expiry_check check (expires_at > created_at)
);
create index creator_invitations_seller_idx on public.creator_invitations (seller_account_id, created_at desc);

-- A creator link is an ordinary campaign link with an owner, so it reuses the
-- whole /l/{token} -> attribution path built in 202607280044/45.
alter table public.campaign_links
  add column creator_partnership_id uuid references public.creator_partnerships(id) on delete set null;
create index campaign_links_partnership_idx on public.campaign_links (creator_partnership_id)
  where creator_partnership_id is not null;

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------

create table public.creator_commission_payments (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete restrict,
  reference text not null unique
    default ('CP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null,
  method text not null check (method in ('mobile_money', 'bank_transfer', 'cash', 'other')),
  external_reference text,
  note text,
  marked_by uuid not null references auth.users(id),
  marked_at timestamptz not null default now(),
  -- SnapDuka records a seller's assertion that they paid, not a transaction it
  -- performed. The creator's confirmation is the only corroboration available,
  -- so it is part of the record rather than an afterthought.
  confirmed_at timestamptz,
  disputed_at timestamptz,
  dispute_note text,
  created_at timestamptz not null default now(),
  constraint creator_payments_resolution_check check (confirmed_at is null or disputed_at is null)
);
create index creator_payments_creator_idx on public.creator_commission_payments (creator_id, marked_at desc);
create index creator_payments_seller_idx on public.creator_commission_payments (seller_account_id, marked_at desc);

create table public.creator_commissions (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete restrict,
  partnership_id uuid not null references public.creator_partnerships(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  campaign_id uuid references public.campaign_links(id) on delete set null,
  attribution_id uuid references public.campaign_attributions(id) on delete set null,
  status public.commission_status not null default 'pending',
  currency public.currency_code not null,
  -- Rate and basis are SNAPSHOTTED, like promotion_snapshot and
  -- order_lines.snapshot: raising a partnership rate must never silently
  -- repay old orders.
  basis_minor bigint not null check (basis_minor >= 0),
  rate_bps integer not null check (rate_bps between 0 and 5000),
  amount_minor bigint not null check (amount_minor >= 0),
  hold_days smallint not null check (hold_days between 0 and 90),
  -- Denormalised so the creator portal never needs RLS access to orders,
  -- customers or shops. A creator compromise must not expose a seller's book.
  order_reference text not null,
  order_placed_at timestamptz not null,
  shop_display_name text not null,
  accrued_at timestamptz not null default now(),
  payable_at timestamptz not null,
  paid_at timestamptz,
  payment_id uuid references public.creator_commission_payments(id) on delete set null,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_commissions_order_key unique (order_id),
  constraint creator_commissions_amount_check
    check (amount_minor = floor(basis_minor::numeric * rate_bps / 10000)::bigint),
  constraint creator_commissions_paid_check check ((status = 'paid') = (paid_at is not null)),
  constraint creator_commissions_reversed_check check ((status = 'reversed') = (reversed_at is not null)),
  constraint creator_commissions_payment_check check (payment_id is null or status = 'paid')
);
create index creator_commissions_creator_status_idx
  on public.creator_commissions (creator_id, status, payable_at);
create index creator_commissions_seller_status_idx
  on public.creator_commissions (seller_account_id, status, payable_at);
create index creator_commissions_release_idx
  on public.creator_commissions (payable_at) where status = 'pending';
create trigger creator_commissions_set_updated_at before update on public.creator_commissions
  for each row execute function public.set_updated_at();

-- Once money has left the seller's hand the commission row is history. A late
-- refund books a negative adjustment against future earnings instead of
-- rewriting what was already settled.
create table public.creator_commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.creator_commissions(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete restrict,
  delta_minor bigint not null check (delta_minor <> 0),
  currency public.currency_code not null,
  reason text not null check (btrim(reason) <> ''),
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);
create index creator_adjustments_creator_idx
  on public.creator_commission_adjustments (creator_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

create function public.current_creator_id() returns uuid
language sql stable security definer set search_path = '' set row_security = off as $$
  select creators.id from public.creators
  where creators.auth_user_id = (select auth.uid()) and creators.status = 'active'
  limit 1
$$;
grant execute on function public.current_creator_id() to authenticated;

alter table public.creators enable row level security;
alter table public.creators force row level security;
alter table public.creator_partnerships enable row level security;
alter table public.creator_partnerships force row level security;
alter table public.creator_invitations enable row level security;
alter table public.creator_invitations force row level security;
alter table public.creator_commissions enable row level security;
alter table public.creator_commissions force row level security;
alter table public.creator_commission_payments enable row level security;
alter table public.creator_commission_payments force row level security;
alter table public.creator_commission_adjustments enable row level security;
alter table public.creator_commission_adjustments force row level security;

-- No INSERT policy on creators: identity is created through a definer RPC, the
-- same shape as seller bootstrapping.
create policy creators_self_read on public.creators
  for select to authenticated using (auth_user_id = (select auth.uid()));
create policy creators_self_update on public.creators
  for update to authenticated using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()) and status = 'active');
create policy creators_partner_read on public.creators
  for select to authenticated using (exists (
    select 1 from public.creator_partnerships p
    where p.creator_id = creators.id
      and p.seller_account_id = (select public.current_seller_account_id())));
create policy creators_operator_read on public.creators
  for select to authenticated using ((select public.is_operator()));

create policy creator_partnerships_seller_all on public.creator_partnerships
  for all to authenticated
  using (seller_account_id = (select public.current_seller_account_id()))
  with check (seller_account_id = (select public.current_seller_account_id())
              and rate_bps between 0 and 5000);
create policy creator_partnerships_creator_read on public.creator_partnerships
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy creator_partnerships_operator_read on public.creator_partnerships
  for select to authenticated using ((select public.is_operator()));

create policy creator_invitations_seller_all on public.creator_invitations
  for all to authenticated
  using (seller_account_id = (select public.current_seller_account_id()))
  with check (seller_account_id = (select public.current_seller_account_id()));

-- The ledger is READ-ONLY to every authenticated role. Only security-definer
-- functions and the service role write here; RLS checks row ownership but not
-- values, so a write policy would let a seller set their own status='paid'.
create policy creator_commissions_seller_read on public.creator_commissions
  for select to authenticated using (seller_account_id = (select public.current_seller_account_id()));
create policy creator_commissions_creator_read on public.creator_commissions
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy creator_commissions_operator_read on public.creator_commissions
  for select to authenticated using ((select public.is_operator()));

create policy creator_payments_seller_read on public.creator_commission_payments
  for select to authenticated using (seller_account_id = (select public.current_seller_account_id()));
create policy creator_payments_creator_read on public.creator_commission_payments
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy creator_payments_operator_read on public.creator_commission_payments
  for select to authenticated using ((select public.is_operator()));

create policy creator_adjustments_seller_read on public.creator_commission_adjustments
  for select to authenticated using (seller_account_id = (select public.current_seller_account_id()));
create policy creator_adjustments_creator_read on public.creator_commission_adjustments
  for select to authenticated using (creator_id = (select public.current_creator_id()));

-- Creators can see their own links and the clicks on them.
create policy campaign_links_creator_read on public.campaign_links
  for select to authenticated using (exists (
    select 1 from public.creator_partnerships p
    where p.id = campaign_links.creator_partnership_id
      and p.creator_id = (select public.current_creator_id())));
create policy attributions_creator_read on public.campaign_attributions
  for select to authenticated using (exists (
    select 1 from public.campaign_links l
    join public.creator_partnerships p on p.id = l.creator_partnership_id
    where l.id = campaign_attributions.campaign_id
      and p.creator_id = (select public.current_creator_id())));

grant select on public.creators, public.creator_partnerships, public.creator_commissions,
  public.creator_commission_payments, public.creator_commission_adjustments to authenticated;
grant update on public.creators to authenticated;
grant select, insert, update, delete on public.creator_invitations to authenticated;
grant insert, update, delete on public.creator_partnerships to authenticated;
grant all on public.creators, public.creator_partnerships, public.creator_invitations,
  public.creator_commissions, public.creator_commission_payments,
  public.creator_commission_adjustments to service_role;
