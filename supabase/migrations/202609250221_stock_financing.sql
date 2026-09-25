-- Revenue-based stock financing through a licensed lending partner (ADR-0014,
-- flag `stock_financing`).
--
-- SnapDuka does not lend. A partner funds each advance; SnapDuka decides who is
-- offered one (from data only SnapDuka has: ledger-captured sales, refunds,
-- chargebacks, trust tier), passes the principal to the seller's wallet when
-- the partner funds it, and collects repayment by sweeping an agreed share of
-- every later hold release. What is swept belongs to the partner and is held
-- for them until remitted.
--
-- Money movements, all through post_ledger_transaction (debit +, credit -):
--
--   disbursement   partner_clearing +P            seller_available -P
--   funding lands  bank_settlement  +P            partner_clearing -P      (record_partner_settlement)
--   sweep          seller_available +s            financing_payable -s
--   remittance     financing_payable +r           partner_clearing -(r - k), financing_fee_revenue -k
--   transfer out   partner_clearing +t            bank_settlement -t       (record_partner_settlement)
--
-- Partner cash moves through bank_settlement, as courier settlements do
-- (202609250192), not processor_clearing: partner money does not pass through
-- Paystack, and booking it there would put the daily Paystack reconciliation
-- out by every advance.
--
-- Why the sweep is a separate worker and not a line inside
-- release_due_order_settlements: that function is the only path by which any
-- seller's money becomes withdrawable. Putting a second product's arithmetic
-- inside its loop means a financing bug (or a lock wait on a financing row)
-- stops every seller's releases, and the two functions would have to be
-- redefined together forever. The worker reads the hold_release transactions
-- the release already writes — one sweep per release, idempotent by the
-- release's ledger transaction id — so the release path is untouched. The cost
-- is a gap of at most one worker tick (5 minutes) in which released money is
-- withdrawable before it is swept; the sweep then takes only what is left and
-- never pushes the balance negative. Accepted: the partner carries repayment
-- risk under revenue-based financing, and the gap is recorded per sweep as a
-- shortfall so it is visible, not silent.

-- ---------------------------------------------------------------------------
-- Ledger plumbing for the new seller-owned kinds
-- ---------------------------------------------------------------------------

-- Rebuilt from the constraint's CURRENT text rather than retyped: other
-- migrations in this release also add seller-owned kinds, and a hardcoded list
-- here would silently drop theirs (or theirs would drop these).
do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'ledger_accounts_owner_check'
     and c.conrelid = 'public.ledger_accounts'::regclass;

  -- Two spellings: ARRAY['a'::kind, ...] as written by 202609250105, and
  -- '{a,b}'::kind[] as this block writes it (so a re-run parses its own output).
  select array_agg(distinct k order by k) into v_kinds
    from (
      select m[1] as k
        from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::(?:public\.)?ledger_account_kind(?!\[)', 'g') as m
      union
      select unnest(string_to_array(m[1], ','))
        from regexp_matches(coalesce(v_def, ''), '''\{([a-z_,]+)\}''::(?:public\.)?ledger_account_kind\[\]', 'g') as m
    ) kinds;

  if v_kinds is null or not ('seller_available' = any (v_kinds)) then
    raise exception 'ledger_accounts_owner_check not in the expected shape: %', v_def;
  end if;

  select array_agg(distinct k order by k) into v_kinds
    from unnest(v_kinds || array['financing_payable', 'ads_prepaid']) as k;

  alter table public.ledger_accounts drop constraint ledger_accounts_owner_check;
  execute format(
    'alter table public.ledger_accounts add constraint ledger_accounts_owner_check check ('
    '(kind = any (%L::public.ledger_account_kind[])) = (owner_seller_account_id is not null))',
    v_kinds);
end;
$$;

/**
 * financing_payable and ads_prepaid may never go negative: the first would mean
 * remitting to the partner more than was swept, the second spending ad budget
 * the seller never paid in.
 *
 * A trigger on the materialised balance rather than an edit to
 * post_ledger_transaction's own restricted list: that function is shared by
 * every money path and redefined by several migrations, and this guard holds
 * whichever version of it is live. The balance UPDATE runs inside the posting,
 * so a violating transaction fails before COMMIT.
 */
create or replace function public.guard_financial_product_balances()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%s for seller %s would go negative (%s).',
                     new.kind, new.owner_seller_account_id, new.balance_minor);
end;
$$;

revoke all on function public.guard_financial_product_balances() from public, anon, authenticated;

drop trigger if exists ledger_accounts_financial_products_nonnegative on public.ledger_accounts;
create trigger ledger_accounts_financial_products_nonnegative
  before update of balance_minor on public.ledger_accounts
  for each row
  when (new.balance_minor < 0
        and new.kind in ('financing_payable'::public.ledger_account_kind,
                         'ads_prepaid'::public.ledger_account_kind))
  execute function public.guard_financial_product_balances();

-- ---------------------------------------------------------------------------
-- Policy: every underwriting and pricing parameter, per market
-- ---------------------------------------------------------------------------

create table public.financing_policies (
  country public.country_code primary key references public.country_configs (country),
  -- Off until a partner agreement exists for the market. The flag gates who
  -- sees the product; this gates whether the market has terms at all.
  enabled boolean not null default false,
  -- Which partner adapter (src/lib/financing/partner.ts) funds this market.
  partner text not null default 'not_configured' check (partner ~ '^[a-z][a-z0-9_]{1,39}$'),
  min_account_age_days integer not null default 180 check (min_account_age_days >= 0),
  min_gmv_90d_minor bigint not null check (min_gmv_90d_minor >= 0),
  min_orders_90d integer not null default 20 check (min_orders_90d >= 0),
  max_refund_rate_bps integer not null default 500 check (max_refund_rate_bps between 0 and 10000),
  max_chargeback_rate_bps integer not null default 100 check (max_chargeback_rate_bps between 0 and 10000),
  eligible_tiers text[] not null default array['silver', 'gold']
    check (eligible_tiers <@ array['new', 'bronze', 'silver', 'gold', 'watch']),
  require_verified boolean not null default true,
  -- Offer = min(max_offer_minor, offer_gmv_bps of the last 90 days' GMV).
  offer_gmv_bps integer not null default 2500 check (offer_gmv_bps between 0 and 10000),
  min_offer_minor bigint not null check (min_offer_minor > 0),
  max_offer_minor bigint not null,
  -- The partner's fixed fee on the principal (not an interest rate: it does not
  -- grow with time, which is what makes revenue-based financing explainable).
  fee_bps integer not null default 600 check (fee_bps between 0 and 2000),
  -- Share of each hold release swept towards repayment.
  sweep_bps integer not null default 1500 check (sweep_bps between 100 and 5000),
  -- SnapDuka's contractual share of the partner's fee. 0 unless the partner
  -- agreement grants a referral share.
  platform_fee_share_bps integer not null default 0 check (platform_fee_share_bps between 0 and 10000),
  offer_valid_days smallint not null default 14 check (offer_valid_days between 1 and 90),
  -- Bumped whenever the seller-facing terms text changes; the seller accepts a
  -- specific version and the advance records which.
  terms_version text not null default 'v1' check (terms_version ~ '^[a-z0-9_.-]{1,20}$'),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financing_policies_offer_range_check check (max_offer_minor >= min_offer_minor)
);

comment on table public.financing_policies is
  'Per-market stock-financing underwriting and pricing (ADR-0014). Placeholder values until a partner agreement sets them; disabled by default.';

create trigger financing_policies_set_updated_at
  before update on public.financing_policies
  for each row execute function public.set_updated_at();

-- Placeholders, deliberately conservative and switched off. The real numbers
-- come from the partner's credit policy.
insert into public.financing_policies (country, min_gmv_90d_minor, min_offer_minor, max_offer_minor)
select cc.country,
       case cc.currency when 'GHS' then 500000 when 'NGN' then 150000000 else 2000000 end,
       case cc.currency when 'GHS' then 50000 when 'NGN' then 10000000 else 200000 end,
       case cc.currency when 'GHS' then 5000000 when 'NGN' then 1000000000 else 20000000 end
  from public.country_configs cc
on conflict (country) do nothing;

-- ---------------------------------------------------------------------------
-- Offers and advances
-- ---------------------------------------------------------------------------

create table public.financing_offers (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  country public.country_code not null,
  currency public.currency_code not null,
  partner text not null,
  principal_minor bigint not null check (principal_minor > 0),
  fee_bps integer not null,
  fee_minor bigint not null check (fee_minor >= 0),
  total_repayable_minor bigint not null,
  sweep_bps integer not null,
  platform_fee_share_minor bigint not null default 0 check (platform_fee_share_minor >= 0),
  terms_version text not null,
  -- The eligibility inputs at the moment of the offer, so "why was I offered
  -- this much" has an answer after the data moves on.
  eligibility jsonb not null check (jsonb_typeof(eligibility) = 'object'),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'expired', 'superseded', 'declined')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financing_offers_total_check check (total_repayable_minor = principal_minor + fee_minor),
  constraint financing_offers_share_check check (platform_fee_share_minor <= fee_minor)
);

create index financing_offers_seller_idx on public.financing_offers (seller_account_id, created_at desc);
create unique index financing_offers_one_open_idx on public.financing_offers (seller_account_id)
  where status = 'open';

create trigger financing_offers_set_updated_at
  before update on public.financing_offers
  for each row execute function public.set_updated_at();

-- No 'offered' state here: an offer lives in financing_offers and becomes an
-- advance only when the seller accepts it. 'cancelled' is the partner declining
-- (or failing) to fund an accepted advance before any money moved.
create type public.financing_advance_state as enum (
  'accepted', 'disbursed', 'repaying', 'repaid', 'cancelled', 'defaulted', 'written_off'
);

create table public.financing_advances (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.financing_offers (id) on delete restrict,
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  country public.country_code not null,
  currency public.currency_code not null,
  partner text not null,
  partner_reference text,
  state public.financing_advance_state not null default 'accepted',
  principal_minor bigint not null check (principal_minor > 0),
  fee_minor bigint not null check (fee_minor >= 0),
  total_repayable_minor bigint not null,
  sweep_bps integer not null check (sweep_bps between 1 and 10000),
  -- What the partner is owed in total, and what SnapDuka keeps. Repayments go to
  -- the partner first; SnapDuka's share comes out of the last money swept.
  partner_share_minor bigint not null,
  platform_fee_share_minor bigint not null check (platform_fee_share_minor >= 0),
  swept_minor bigint not null default 0,
  remitted_minor bigint not null default 0,
  fee_revenue_minor bigint not null default 0,
  terms_version text not null,
  accepted_by uuid not null,
  accepted_at timestamptz not null default now(),
  disbursed_at timestamptz,
  repaid_at timestamptz,
  closed_at timestamptz,
  state_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financing_advances_offer_key unique (offer_id),
  constraint financing_advances_total_check check (total_repayable_minor = principal_minor + fee_minor),
  constraint financing_advances_split_check
    check (partner_share_minor + platform_fee_share_minor = total_repayable_minor),
  constraint financing_advances_progress_check check (
    swept_minor between 0 and total_repayable_minor
    and remitted_minor between 0 and partner_share_minor
    and fee_revenue_minor between 0 and platform_fee_share_minor
    and remitted_minor + fee_revenue_minor <= swept_minor
  ),
  constraint financing_advances_disbursed_check
    check ((state in ('accepted', 'cancelled')) = (disbursed_at is null))
);

comment on table public.financing_advances is
  'Partner-funded stock-financing advances. Money moves only through the functions in 202609250221; service-role only.';

create index financing_advances_seller_idx on public.financing_advances (seller_account_id, created_at desc);
create index financing_advances_sweepable_idx on public.financing_advances (disbursed_at)
  where state in ('disbursed', 'repaying');
-- One live advance per seller: a second would sweep the same releases twice.
create unique index financing_advances_one_live_idx on public.financing_advances (seller_account_id)
  where state in ('accepted', 'disbursed', 'repaying');

create trigger financing_advances_set_updated_at
  before update on public.financing_advances
  for each row execute function public.set_updated_at();

-- One row per hold release examined for an advance, including releases that
-- swept nothing, so a release is looked at exactly once.
create table public.financing_sweeps (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.financing_advances (id) on delete restrict,
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  source_transaction_id uuid not null references public.ledger_transactions (id) on delete restrict,
  release_minor bigint not null check (release_minor >= 0),
  target_minor bigint not null check (target_minor >= 0),
  swept_minor bigint not null check (swept_minor >= 0 and swept_minor <= target_minor),
  -- target - swept: what the seller's balance could not cover when the sweep
  -- ran (withdrawn in the gap, or already in arrears). Not carried forward.
  shortfall_minor bigint generated always as (target_minor - swept_minor) stored,
  ledger_transaction_id uuid references public.ledger_transactions (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint financing_sweeps_source_key unique (advance_id, source_transaction_id)
);

create index financing_sweeps_advance_idx on public.financing_sweeps (advance_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access: service-role only. Sellers and the app read through server routes
-- that filter by the resolved seller explicitly.
-- ---------------------------------------------------------------------------

alter table public.financing_policies enable row level security;
alter table public.financing_policies force row level security;
alter table public.financing_offers enable row level security;
alter table public.financing_offers force row level security;
alter table public.financing_advances enable row level security;
alter table public.financing_advances force row level security;
alter table public.financing_sweeps enable row level security;
alter table public.financing_sweeps force row level security;

revoke all on public.financing_policies, public.financing_offers,
              public.financing_advances, public.financing_sweeps
  from public, anon, authenticated;
grant select on public.financing_policies, public.financing_offers,
                public.financing_advances, public.financing_sweeps
  to service_role;
-- Operators tune policy from /admin/capital; every other write is a function.
grant update on public.financing_policies to service_role;
revoke insert, update, delete on public.financing_offers, public.financing_advances,
                                 public.financing_sweeps from service_role;

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------

/**
 * Whether a seller qualifies for an advance today and, if so, the offer.
 *
 * Everything is read from data SnapDuka holds, over the last 90 days:
 *   gmv       goods + delivery on ledger-captured orders (order_settlements;
 *             the buyer's Protect fee is excluded — it was never the seller's)
 *   refunds   clawed_back_minor on those settlements, as a share of GMV
 *   disputes  card chargebacks (payment_disputes) per captured order
 * plus trust tier, verification, account age and settlement mode. Only ledger
 * sellers qualify: repayment is a ledger sweep, and a subaccount seller's money
 * never passes through SnapDuka to be swept.
 *
 * Returns every failing reason, not the first, so the seller sees the whole
 * list of what to fix.
 */
create or replace function public.financing_eligibility(p_seller_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  sa public.seller_accounts%rowtype;
  pol public.financing_policies%rowtype;
  v_currency public.currency_code;
  v_reasons text[] := '{}';
  v_age_days integer;
  v_verified boolean;
  v_tier text;
  v_gmv bigint;
  v_refunded bigint;
  v_orders integer;
  v_disputes integer;
  v_refund_bps integer;
  v_chargeback_bps integer;
  v_principal bigint := 0;
  v_fee bigint := 0;
  v_share bigint := 0;
  v_since timestamptz := now() - interval '90 days';
begin
  select * into sa from public.seller_accounts where id = p_seller_account_id;
  if sa.id is null then
    raise exception using errcode = 'P0002', message = 'Seller not found.';
  end if;

  select * into pol from public.financing_policies where country = sa.country;
  select currency into v_currency from public.country_configs where country = sa.country;

  if pol.country is null or not pol.enabled then
    v_reasons := array_append(v_reasons, 'market_not_available');
  end if;
  if sa.status <> 'active' then
    v_reasons := array_append(v_reasons, 'account_not_active');
  end if;
  if public.seller_settlement_mode(sa.id) <> 'ledger' then
    v_reasons := array_append(v_reasons, 'not_on_ledger');
  end if;

  v_age_days := floor(extract(epoch from (now() - sa.created_at)) / 86400)::integer;
  select exists (select 1 from public.seller_verifications v
                  where v.seller_account_id = sa.id and v.state = 'verified')
    into v_verified;
  select t.tier into v_tier from public.seller_trust_scores t where t.seller_account_id = sa.id;

  select coalesce(sum(st.gross_minor - st.protect_fee_minor), 0)::bigint,
         coalesce(sum(st.clawed_back_minor), 0)::bigint,
         count(*)::integer
    into v_gmv, v_refunded, v_orders
    from public.order_settlements st
   where st.seller_account_id = sa.id
     and st.currency = v_currency
     and st.captured_at >= v_since;

  select count(*)::integer into v_disputes
    from public.payment_disputes d
   where d.seller_account_id = sa.id and d.created_at >= v_since;

  v_refund_bps := case when v_gmv > 0 then ((v_refunded * 10000) / v_gmv)::integer else 0 end;
  v_chargeback_bps := case when v_orders > 0 then ((v_disputes::bigint * 10000) / v_orders)::integer else 0 end;

  if pol.country is not null then
    if v_age_days < pol.min_account_age_days then v_reasons := array_append(v_reasons, 'account_too_new'); end if;
    if pol.require_verified and not v_verified then v_reasons := array_append(v_reasons, 'not_verified'); end if;
    if v_tier is null or not (v_tier = any (pol.eligible_tiers)) then
      v_reasons := array_append(v_reasons, 'trust_tier');
    end if;
    if v_gmv < pol.min_gmv_90d_minor then v_reasons := array_append(v_reasons, 'sales_too_low'); end if;
    if v_orders < pol.min_orders_90d then v_reasons := array_append(v_reasons, 'too_few_orders'); end if;
    if v_refund_bps > pol.max_refund_rate_bps then v_reasons := array_append(v_reasons, 'refund_rate'); end if;
    if v_chargeback_bps > pol.max_chargeback_rate_bps then v_reasons := array_append(v_reasons, 'chargeback_rate'); end if;

    -- Fee floors down and the share floors down: rounding never costs the seller.
    v_principal := least(pol.max_offer_minor, (v_gmv * pol.offer_gmv_bps) / 10000);
    v_fee := (v_principal * pol.fee_bps) / 10000;
    v_share := (v_fee * pol.platform_fee_share_bps) / 10000;
    if v_principal < pol.min_offer_minor then v_reasons := array_append(v_reasons, 'offer_below_minimum'); end if;
  end if;

  if exists (select 1 from public.financing_advances a
              where a.seller_account_id = sa.id and a.state in ('accepted', 'disbursed', 'repaying')) then
    v_reasons := array_append(v_reasons, 'active_advance');
  end if;
  if exists (select 1 from public.financing_advances a
              where a.seller_account_id = sa.id and a.state in ('defaulted', 'written_off')) then
    v_reasons := array_append(v_reasons, 'prior_default');
  end if;

  return jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0,
    'reasons', to_jsonb(v_reasons),
    'country', sa.country,
    'currency', v_currency,
    'partner', coalesce(pol.partner, 'not_configured'),
    'gmv90dMinor', v_gmv,
    'orders90d', v_orders,
    'refundRateBps', v_refund_bps,
    'chargebackRateBps', v_chargeback_bps,
    'trustTier', v_tier,
    'verified', v_verified,
    'accountAgeDays', v_age_days,
    'offer', case when v_principal >= coalesce(pol.min_offer_minor, 1) then jsonb_build_object(
      'principalMinor', v_principal,
      'feeBps', pol.fee_bps,
      'feeMinor', v_fee,
      'totalRepayableMinor', v_principal + v_fee,
      'sweepBps', pol.sweep_bps,
      'platformFeeShareMinor', v_share,
      'termsVersion', pol.terms_version,
      'validDays', pol.offer_valid_days) end
  );
end;
$$;

revoke all on function public.financing_eligibility(uuid) from public, anon, authenticated;
grant execute on function public.financing_eligibility(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Offer -> accept -> disburse
-- ---------------------------------------------------------------------------

/**
 * The seller's current open offer, creating one if they qualify. Returns NULL
 * when they do not qualify (the caller shows financing_eligibility's reasons).
 *
 * Serialised per seller on the seller_accounts row so two tabs cannot mint two
 * offers. An existing unexpired offer is returned as is: terms do not move
 * under a seller who is reading them.
 */
create or replace function public.create_financing_offer(p_seller_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_id uuid;
  v_elig jsonb;
  v_offer jsonb;
begin
  perform 1 from public.seller_accounts where id = p_seller_account_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Seller not found.';
  end if;

  update public.financing_offers
     set status = 'expired'
   where seller_account_id = p_seller_account_id and status = 'open' and expires_at <= now();

  select id into v_id from public.financing_offers
   where seller_account_id = p_seller_account_id and status = 'open';
  if v_id is not null then return v_id; end if;

  v_elig := public.financing_eligibility(p_seller_account_id);
  if not (v_elig->>'eligible')::boolean then return null; end if;
  v_offer := v_elig->'offer';

  insert into public.financing_offers (
    seller_account_id, country, currency, partner,
    principal_minor, fee_bps, fee_minor, total_repayable_minor, sweep_bps,
    platform_fee_share_minor, terms_version, eligibility, expires_at)
  values (
    p_seller_account_id,
    (v_elig->>'country')::public.country_code,
    (v_elig->>'currency')::public.currency_code,
    v_elig->>'partner',
    (v_offer->>'principalMinor')::bigint,
    (v_offer->>'feeBps')::integer,
    (v_offer->>'feeMinor')::bigint,
    (v_offer->>'totalRepayableMinor')::bigint,
    (v_offer->>'sweepBps')::integer,
    (v_offer->>'platformFeeShareMinor')::bigint,
    v_offer->>'termsVersion',
    v_elig - 'offer',
    now() + make_interval(days => (v_offer->>'validDays')::integer))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_financing_offer(uuid) from public, anon, authenticated;
grant execute on function public.create_financing_offer(uuid) to service_role;

/**
 * The seller accepts an offer. Creates the advance in 'accepted'; no money
 * moves until the partner confirms funding (record_financing_disbursement).
 *
 * The caller passes back the total and terms version the seller was SHOWN, and
 * both must match the offer: acceptance is of specific numbers, so a stale page
 * cannot accept terms the seller never saw. Eligibility is re-checked because a
 * chargeback or refund may have landed since the offer was made.
 */
create or replace function public.accept_financing_offer(
  p_offer_id uuid,
  p_seller_account_id uuid,
  p_accepted_by uuid,
  p_expected_total_minor bigint,
  p_terms_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  o public.financing_offers%rowtype;
  v_elig jsonb;
  v_reasons jsonb;
  v_id uuid;
begin
  if p_accepted_by is null then
    raise exception using errcode = '22023', message = 'Acceptance needs the accepting user.';
  end if;

  select * into o from public.financing_offers
   where id = p_offer_id and seller_account_id = p_seller_account_id
   for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Offer not found.';
  end if;
  if o.status <> 'open' or o.expires_at <= now() then
    raise exception using errcode = '55000', message = 'This offer is no longer available.';
  end if;
  if o.total_repayable_minor <> p_expected_total_minor or o.terms_version <> p_terms_version then
    raise exception using errcode = '55000',
      message = 'The terms have changed since you opened this page. Review them again.';
  end if;

  v_elig := public.financing_eligibility(p_seller_account_id);
  -- 'active_advance' cannot be true here without the unique index also firing,
  -- but the reasons list is the seller-facing explanation either way.
  v_reasons := v_elig->'reasons';
  if jsonb_array_length(v_reasons) > 0 then
    raise exception using errcode = '55000',
      message = 'You no longer qualify for this offer.', detail = v_reasons::text;
  end if;

  insert into public.financing_advances (
    offer_id, seller_account_id, country, currency, partner, state,
    principal_minor, fee_minor, total_repayable_minor, sweep_bps,
    partner_share_minor, platform_fee_share_minor, terms_version, accepted_by)
  values (
    o.id, o.seller_account_id, o.country, o.currency, o.partner, 'accepted',
    o.principal_minor, o.fee_minor, o.total_repayable_minor, o.sweep_bps,
    o.total_repayable_minor - o.platform_fee_share_minor, o.platform_fee_share_minor,
    o.terms_version, p_accepted_by)
  returning id into v_id;

  update public.financing_offers set status = 'accepted', accepted_at = now() where id = o.id;

  perform public.emit_domain_event('financing_advance', v_id, 'financing.accepted',
    jsonb_build_object('advanceId', v_id, 'sellerAccountId', o.seller_account_id,
                       'principalMinor', o.principal_minor, 'currency', o.currency),
    'financing.accepted:' || v_id::text);

  return v_id;
end;
$$;

revoke all on function public.accept_financing_offer(uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.accept_financing_offer(uuid, uuid, uuid, bigint, text) to service_role;

/**
 * The partner has funded the advance: credit the principal to the seller's
 * available balance against partner_clearing (the partner owes SnapDuka that
 * cash until record_partner_settlement books it landing).
 *
 * Idempotent: a replay (webhook redelivery, retried worker) for an advance
 * already disbursed returns NULL, the same "already done" contract as
 * post_ledger_transaction.
 */
create or replace function public.record_financing_disbursement(
  p_advance_id uuid,
  p_partner_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  a public.financing_advances%rowtype;
  v_txn uuid;
begin
  if coalesce(btrim(p_partner_reference), '') = '' then
    raise exception using errcode = '22023', message = 'A disbursement needs the partner reference.';
  end if;

  select * into a from public.financing_advances where id = p_advance_id for update;
  if a.id is null then
    raise exception using errcode = 'P0002', message = 'Advance not found.';
  end if;
  if a.state <> 'accepted' then
    if a.disbursed_at is not null and a.partner_reference = p_partner_reference then
      return null;
    end if;
    raise exception using errcode = '55000',
      message = format('Advance %s is %s and cannot be disbursed.', a.id, a.state);
  end if;

  v_txn := public.post_ledger_transaction(
    'financing_disbursement',
    'financing_disbursement:' || a.id::text,
    a.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'partner_clearing', 'amount_minor', a.principal_minor),
      jsonb_build_object('kind', 'seller_available', 'seller_account_id', a.seller_account_id,
                         'amount_minor', -a.principal_minor)),
    a.seller_account_id, null, null, null,
    'Stock financing advance received',
    jsonb_build_object('advanceId', a.id, 'partner', a.partner, 'partnerReference', p_partner_reference));

  update public.financing_advances
     set state = 'disbursed', disbursed_at = now(), partner_reference = p_partner_reference
   where id = a.id;

  perform public.emit_domain_event('financing_advance', a.id, 'financing.disbursed',
    jsonb_build_object('advanceId', a.id, 'sellerAccountId', a.seller_account_id,
                       'principalMinor', a.principal_minor, 'currency', a.currency),
    'financing.disbursed:' || a.id::text);

  return v_txn;
end;
$$;

revoke all on function public.record_financing_disbursement(uuid, text) from public, anon, authenticated;
grant execute on function public.record_financing_disbursement(uuid, text) to service_role;

/** The partner declined or failed to fund an accepted advance. No money moved. */
create or replace function public.cancel_financing_advance(p_advance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  update public.financing_advances
     set state = 'cancelled', closed_at = now(), state_reason = left(p_reason, 500)
   where id = p_advance_id and state = 'accepted';
  if not found then
    raise exception using errcode = '55000', message = 'Only an advance awaiting funding can be cancelled.';
  end if;
end;
$$;

revoke all on function public.cancel_financing_advance(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_financing_advance(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Repayment
-- ---------------------------------------------------------------------------

/**
 * Sweeps sweep_bps of every hold release since disbursement into
 * financing_payable. See the header for why this is a worker.
 *
 * Per release: target = floor(release * sweep_bps / 10000); swept =
 * min(target, still owed, the seller's available balance if positive). Never
 * more than owed; never pushes seller_available below zero (a seller already in
 * arrears is repaying SnapDuka's clawback first). One transaction per advance
 * row lock, skip locked, bounded per run.
 */
create or replace function public.sweep_financing_repayments(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  a public.financing_advances%rowtype;
  r record;
  v_available_account uuid;
  v_available bigint;
  v_owed bigint;
  v_target bigint;
  v_amount bigint;
  v_txn uuid;
  v_sweeps integer := 0;
  v_swept_total bigint := 0;
begin
  for a in
    select * from public.financing_advances
     where state in ('disbursed', 'repaying')
     order by disbursed_at
     limit greatest(1, least(p_limit, 1000))
     for update skip locked
  loop
    for r in
      select t.id, t.posted_at,
             (select -sum(e.amount_minor)::bigint
                from public.ledger_entries e
                join public.ledger_accounts la on la.id = e.account_id
               where e.transaction_id = t.id and la.kind = 'seller_available') as release_minor
        from public.ledger_transactions t
       where t.seller_account_id = a.seller_account_id
         and t.kind = 'hold_release'
         and t.currency = a.currency
         and t.posted_at >= a.disbursed_at
         and not exists (select 1 from public.financing_sweeps s
                          where s.advance_id = a.id and s.source_transaction_id = t.id)
       order by t.posted_at, t.id
       limit 500
    loop
      v_owed := a.total_repayable_minor - a.swept_minor;
      exit when v_owed <= 0;

      v_target := least((greatest(coalesce(r.release_minor, 0), 0) * a.sweep_bps) / 10000, v_owed);

      v_available_account := public.ledger_account_for('seller_available', a.currency, a.seller_account_id);
      select balance_minor into v_available
        from public.ledger_accounts where id = v_available_account for update;
      v_amount := least(v_target, greatest(v_available, 0));

      v_txn := null;
      if v_amount > 0 then
        v_txn := public.post_ledger_transaction(
          'financing_sweep',
          'financing_sweep:' || a.id::text || ':' || r.id::text,
          a.currency,
          jsonb_build_array(
            jsonb_build_object('kind', 'seller_available', 'seller_account_id', a.seller_account_id,
                               'amount_minor', v_amount),
            jsonb_build_object('kind', 'financing_payable', 'seller_account_id', a.seller_account_id,
                               'amount_minor', -v_amount)),
          a.seller_account_id, null, null, null,
          'Stock financing repayment',
          jsonb_build_object('advanceId', a.id, 'releaseTransactionId', r.id,
                             'releaseMinor', r.release_minor, 'sweepBps', a.sweep_bps));
        -- NULL would mean this exact sweep was already posted, which the
        -- financing_sweeps check above rules out; refuse rather than count
        -- money that did not move.
        if v_txn is null then
          raise exception using errcode = '55000',
            message = format('Sweep of release %s for advance %s was already posted.', r.id, a.id);
        end if;
      end if;

      insert into public.financing_sweeps (
        advance_id, seller_account_id, source_transaction_id,
        release_minor, target_minor, swept_minor, ledger_transaction_id)
      values (a.id, a.seller_account_id, r.id,
              greatest(coalesce(r.release_minor, 0), 0), v_target, v_amount, v_txn);

      a.swept_minor := a.swept_minor + v_amount;
      if a.swept_minor >= a.total_repayable_minor then
        a.state := 'repaid';
        a.repaid_at := now();
      elsif v_amount > 0 and a.state = 'disbursed' then
        a.state := 'repaying';
      end if;

      v_sweeps := v_sweeps + 1;
      v_swept_total := v_swept_total + v_amount;
    end loop;

    update public.financing_advances
       set swept_minor = a.swept_minor, state = a.state, repaid_at = a.repaid_at
     where id = a.id;

    if a.state = 'repaid' then
      perform public.emit_domain_event('financing_advance', a.id, 'financing.repaid',
        jsonb_build_object('advanceId', a.id, 'sellerAccountId', a.seller_account_id),
        'financing.repaid:' || a.id::text);
    end if;
  end loop;

  return jsonb_build_object('sweeps', v_sweeps, 'sweptMinor', v_swept_total);
end;
$$;

revoke all on function public.sweep_financing_repayments(integer) from public, anon, authenticated;
grant execute on function public.sweep_financing_repayments(integer) to service_role;

/**
 * Moves swept money from the seller's financing_payable to what SnapDuka owes
 * the partner (partner_clearing), keeping SnapDuka's contractual fee share, if
 * any, from the LAST money swept: the partner is paid in full first.
 *
 * Runs for any advance with unremitted money, including defaulted and
 * written-off ones — what was swept before closure is still the partner's.
 * The event key is the cumulative amount accounted for after this remittance,
 * which is unique per advance and makes a replay a no-op.
 */
create or replace function public.remit_financing_payables(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  a public.financing_advances%rowtype;
  v_unremitted bigint;
  v_to_partner bigint;
  v_to_platform bigint;
  v_count integer := 0;
  v_total bigint := 0;
begin
  for a in
    select * from public.financing_advances
     where swept_minor > remitted_minor + fee_revenue_minor
     order by updated_at
     limit greatest(1, least(p_limit, 1000))
     for update skip locked
  loop
    v_unremitted := a.swept_minor - a.remitted_minor - a.fee_revenue_minor;
    v_to_partner := least(v_unremitted, a.partner_share_minor - a.remitted_minor);
    v_to_platform := v_unremitted - v_to_partner;

    perform public.post_ledger_transaction(
      'financing_remittance',
      'financing_remittance:' || a.id::text || ':' || a.swept_minor::text,
      a.currency,
      jsonb_build_array(
        jsonb_build_object('kind', 'financing_payable', 'seller_account_id', a.seller_account_id,
                           'amount_minor', v_unremitted),
        jsonb_build_object('kind', 'partner_clearing', 'amount_minor', -v_to_partner),
        jsonb_build_object('kind', 'financing_fee_revenue', 'amount_minor', -v_to_platform)),
      a.seller_account_id, null, null, null,
      'Stock financing repayment due to partner',
      jsonb_build_object('advanceId', a.id, 'partner', a.partner,
                         'toPartnerMinor', v_to_partner, 'feeShareMinor', v_to_platform));

    update public.financing_advances
       set remitted_minor = remitted_minor + v_to_partner,
           fee_revenue_minor = fee_revenue_minor + v_to_platform
     where id = a.id;

    v_count := v_count + 1;
    v_total := v_total + v_unremitted;
  end loop;

  return jsonb_build_object('advances', v_count, 'remittedMinor', v_total);
end;
$$;

revoke all on function public.remit_financing_payables(integer) from public, anon, authenticated;
grant execute on function public.remit_financing_payables(integer) to service_role;

/**
 * Real cash moving between SnapDuka's bank and the partner.
 *
 *   from_partner  the partner's funding for disbursed advances has landed
 *   to_partner    SnapDuka has transferred remitted repayments to the partner
 *
 * Bounded cumulatively, per currency, so neither direction can overshoot:
 * everything ever received from the partner <= every principal disbursed, and
 * everything ever paid to the partner <= every repayment remitted to them.
 * Not bounded by partner_clearing's balance: that nets both directions, so a
 * transfer of remitted repayments would be refused merely because the
 * partner's funding had not been recorded yet. Keyed on the bank/partner
 * reference, so a replay is a no-op.
 */
create or replace function public.record_partner_settlement(
  p_currency public.currency_code,
  p_direction text,
  p_amount_minor bigint,
  p_reference text,
  p_recorded_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_account uuid;
  v_settled bigint;
  v_limit bigint;
begin
  if p_direction not in ('from_partner', 'to_partner') then
    raise exception using errcode = '22023', message = 'Direction must be from_partner or to_partner.';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'Amount must be positive.';
  end if;
  if coalesce(btrim(p_reference), '') = '' then
    raise exception using errcode = '22023', message = 'A settlement needs a reference.';
  end if;

  if exists (select 1 from public.ledger_transactions
              where event_key = 'partner_settlement:' || p_reference) then
    return null;
  end if;

  -- Serialise settlements per currency on the clearing account's row.
  v_account := public.ledger_account_for('partner_clearing', p_currency, null);
  perform 1 from public.ledger_accounts where id = v_account for update;

  select coalesce(sum(case when t.metadata->>'direction' = p_direction then e.amount_minor end), 0)::bigint
    into v_settled
    from public.ledger_transactions t
    join public.ledger_entries e on e.transaction_id = t.id
    join public.ledger_accounts la on la.id = e.account_id and la.kind = 'bank_settlement'
   where t.kind = 'partner_settlement' and t.currency = p_currency;
  -- bank_settlement is debited by money in, credited by money out.
  v_settled := abs(v_settled);

  if p_direction = 'from_partner' then
    select coalesce(sum(principal_minor), 0)::bigint into v_limit
      from public.financing_advances where currency = p_currency and disbursed_at is not null;
  else
    select coalesce(sum(remitted_minor), 0)::bigint into v_limit
      from public.financing_advances where currency = p_currency;
  end if;

  if v_settled + p_amount_minor > v_limit then
    raise exception using errcode = '23514',
      message = format('%s: %s already recorded of %s due; cannot record %s more.',
                       p_direction, v_settled, v_limit, p_amount_minor);
  end if;

  return public.post_ledger_transaction(
    'partner_settlement',
    'partner_settlement:' || p_reference,
    p_currency,
    case p_direction
      when 'from_partner' then jsonb_build_array(
        jsonb_build_object('kind', 'bank_settlement', 'amount_minor', p_amount_minor),
        jsonb_build_object('kind', 'partner_clearing', 'amount_minor', -p_amount_minor))
      else jsonb_build_array(
        jsonb_build_object('kind', 'partner_clearing', 'amount_minor', p_amount_minor),
        jsonb_build_object('kind', 'bank_settlement', 'amount_minor', -p_amount_minor))
    end,
    null, null, null, null,
    case p_direction when 'from_partner' then 'Lending partner funding received'
                     else 'Repayments transferred to lending partner' end,
    jsonb_build_object('direction', p_direction, 'reference', p_reference, 'recordedBy', p_recorded_by));
end;
$$;

revoke all on function public.record_partner_settlement(public.currency_code, text, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.record_partner_settlement(public.currency_code, text, bigint, text, uuid) to service_role;

/**
 * The partner has declared an advance defaulted (collection moves off-platform)
 * or written the remainder off. Sweeping stops; anything already swept is still
 * remitted. No ledger entry: the unpaid remainder is a debt between the seller
 * and the partner, never SnapDuka's asset, so there is nothing for SnapDuka to
 * write off.
 */
create or replace function public.close_financing_advance(
  p_advance_id uuid,
  p_state public.financing_advance_state,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_state not in ('defaulted', 'written_off') then
    raise exception using errcode = '22023', message = 'An advance closes as defaulted or written_off.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception using errcode = '22023', message = 'Closing an advance needs a reason.';
  end if;

  update public.financing_advances
     set state = p_state, closed_at = now(), state_reason = left(p_reason, 500)
   where id = p_advance_id and state in ('disbursed', 'repaying');
  if not found then
    raise exception using errcode = '55000', message = 'Only a disbursed advance can be closed.';
  end if;

  perform public.emit_domain_event('financing_advance', p_advance_id, 'financing.closed',
    jsonb_build_object('advanceId', p_advance_id, 'state', p_state),
    'financing.closed:' || p_advance_id::text);
end;
$$;

revoke all on function public.close_financing_advance(uuid, public.financing_advance_state, text) from public, anon, authenticated;
grant execute on function public.close_financing_advance(uuid, public.financing_advance_state, text) to service_role;

/**
 * What SnapDuka owes each currency's lending partner in cash right now:
 * everything remitted to them minus everything already transferred. Read by the
 * daily settle worker, which pays it through the partner adapter and records
 * the transfer with record_partner_settlement. `transferred_minor` is the
 * cumulative total so the worker can build a replay-stable reference.
 *
 * One partner per currency is assumed (partner_clearing has no partner
 * dimension); `partners` > 1 tells the worker to stop and page someone rather
 * than pay the wrong lender.
 */
create or replace function public.financing_partner_amounts_due()
returns table (currency public.currency_code, partner text, partners integer,
               remitted_minor bigint, transferred_minor bigint, due_minor bigint)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  with remitted as (
    select a.currency, min(a.partner) as partner, count(distinct a.partner)::integer as partners,
           sum(a.remitted_minor)::bigint as total
      from public.financing_advances a
     where a.remitted_minor > 0
     group by a.currency
  ),
  transferred as (
    select t.currency, (-sum(e.amount_minor))::bigint as total
      from public.ledger_transactions t
      join public.ledger_entries e on e.transaction_id = t.id
      join public.ledger_accounts la on la.id = e.account_id and la.kind = 'bank_settlement'
     where t.kind = 'partner_settlement' and t.metadata->>'direction' = 'to_partner'
     group by t.currency
  )
  select r.currency, r.partner, r.partners, r.total, coalesce(x.total, 0)::bigint,
         (r.total - coalesce(x.total, 0))::bigint
    from remitted r left join transferred x on x.currency = r.currency;
$$;

revoke all on function public.financing_partner_amounts_due() from public, anon, authenticated;
grant execute on function public.financing_partner_amounts_due() to service_role;
