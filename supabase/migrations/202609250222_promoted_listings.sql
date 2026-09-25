-- Promoted listings: prepaid, per-click ads in a labelled "Sponsored" slot on
-- /discover (ADR-0014, flag `promoted_listings`).
--
-- The roadmap gates this at roughly 10k weekly active sellers: below that the
-- directory is small enough that paid placement crowds out organic results
-- rather than adding reach. Everything here ships dark behind the flag.
--
-- Money, through post_ledger_transaction only:
--   top-up     seller_available +x   ads_prepaid -x      (prepaid: no ad credit, ever)
--   click      ads_prepaid +p        ads_revenue -p
--   withdraw   ads_prepaid +y        seller_available -y (unused budget is the seller's)
--
-- Auction: generalised second price with a reserve. Eligible campaigns are
-- ranked by bid (one per seller, so a single big spender cannot fill every
-- slot); slot i pays min(own bid, next bid + 1 minor unit), never below the
-- market's minimum bid. Quality does not enter the rank yet: there is no
-- click-through history to estimate it from, and a guessed quality score would
-- be an unexplainable price. Revisit once ad_clicks has volume (ADR-0014).

-- ---------------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------------

create table public.ad_policies (
  country public.country_code primary key references public.country_configs (country),
  min_bid_minor bigint not null check (min_bid_minor > 0),
  max_bid_minor bigint not null,
  min_daily_budget_minor bigint not null check (min_daily_budget_minor > 0),
  max_daily_budget_minor bigint not null,
  min_top_up_minor bigint not null check (min_top_up_minor > 0),
  sponsored_slots smallint not null default 3 check (sponsored_slots between 0 and 12),
  max_products_per_campaign smallint not null default 10 check (max_products_per_campaign between 1 and 50),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_policies_bid_range_check check (max_bid_minor >= min_bid_minor),
  constraint ad_policies_budget_range_check check (max_daily_budget_minor >= min_daily_budget_minor)
);

create trigger ad_policies_set_updated_at
  before update on public.ad_policies
  for each row execute function public.set_updated_at();

insert into public.ad_policies (country, min_bid_minor, max_bid_minor, min_daily_budget_minor,
                                max_daily_budget_minor, min_top_up_minor)
select cc.country,
       case cc.currency when 'GHS' then 20 when 'NGN' then 2000 else 100 end,
       case cc.currency when 'GHS' then 2000 when 'NGN' then 200000 else 10000 end,
       case cc.currency when 'GHS' then 500 when 'NGN' then 50000 else 2500 end,
       case cc.currency when 'GHS' then 100000 when 'NGN' then 10000000 else 500000 end,
       case cc.currency when 'GHS' then 1000 when 'NGN' then 100000 else 5000 end
  from public.country_configs cc
on conflict (country) do nothing;

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

-- active        in the auction while it has budget today and prepaid balance
-- paused        by the seller
-- out_of_funds  prepaid balance below the bid; back to active on top-up
-- ended         terminal
create type public.ad_campaign_state as enum ('active', 'paused', 'out_of_funds', 'ended');

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  country public.country_code not null,
  currency public.currency_code not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  daily_budget_minor bigint not null check (daily_budget_minor > 0),
  bid_minor bigint not null check (bid_minor > 0),
  state public.ad_campaign_state not null default 'active',
  created_by uuid not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_campaigns_budget_covers_bid check (daily_budget_minor >= bid_minor),
  constraint ad_campaigns_ended_check check ((state = 'ended') = (ended_at is not null))
);

create index ad_campaigns_seller_idx on public.ad_campaigns (seller_account_id, created_at desc);
create index ad_campaigns_auction_idx on public.ad_campaigns (country, bid_minor desc) where state = 'active';

create trigger ad_campaigns_set_updated_at
  before update on public.ad_campaigns
  for each row execute function public.set_updated_at();

create table public.ad_campaign_products (
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (campaign_id, product_id)
);

create index ad_campaign_products_product_idx on public.ad_campaign_products (product_id);

/**
 * The product and the campaign must belong to the seller named on the row.
 * A check trigger rather than a composite foreign key: a second key over
 * overlapping columns breaks PostgREST embeds (PGRST201; see
 * 202609050084_drop_duplicate_single_column_fks.sql).
 */
create or replace function public.ad_campaign_products_tenant_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.ad_campaigns c
                  where c.id = new.campaign_id and c.seller_account_id = new.seller_account_id)
     or not exists (select 1 from public.products p
                     where p.id = new.product_id and p.seller_account_id = new.seller_account_id) then
    raise exception using errcode = '23514',
      message = 'A promoted product must belong to the campaign''s seller.';
  end if;
  return new;
end;
$$;

revoke all on function public.ad_campaign_products_tenant_check() from public, anon, authenticated;

create trigger ad_campaign_products_tenant
  before insert or update on public.ad_campaign_products
  for each row execute function public.ad_campaign_products_tenant_check();

-- Billed clicks only. Bot traffic and repeat clicks are dropped before they get
-- here (src/lib/ads/clicks.ts), so this table is exactly what sellers paid for
-- and ads_revenue must equal its sum (check_financial_product_invariants).
create table public.ad_clicks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  currency public.currency_code not null,
  -- Visitor cookie id, or an HMAC of ip+UA when there is none. Never a raw IP.
  viewer_key text not null check (viewer_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  -- UTC day. Budgets and dedupe both reset at 00:00 UTC (= GMT, Ghana's time).
  click_date date not null default ((now() at time zone 'utc')::date),
  price_minor bigint not null check (price_minor > 0),
  placement text not null default 'discover' check (placement ~ '^[a-z_]{1,30}$'),
  ledger_transaction_id uuid references public.ledger_transactions (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- One billed click per campaign per viewer per day.
  constraint ad_clicks_dedupe_key unique (campaign_id, viewer_key, click_date)
);

create index ad_clicks_campaign_day_idx on public.ad_clicks (campaign_id, click_date);
create index ad_clicks_seller_idx on public.ad_clicks (seller_account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access: service-role only (reads through server routes; writes through the
-- functions below).
-- ---------------------------------------------------------------------------

alter table public.ad_policies enable row level security;
alter table public.ad_policies force row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_campaigns force row level security;
alter table public.ad_campaign_products enable row level security;
alter table public.ad_campaign_products force row level security;
alter table public.ad_clicks enable row level security;
alter table public.ad_clicks force row level security;

revoke all on public.ad_policies, public.ad_campaigns, public.ad_campaign_products, public.ad_clicks
  from public, anon, authenticated;
grant select on public.ad_policies, public.ad_campaigns, public.ad_campaign_products, public.ad_clicks
  to service_role;
grant update on public.ad_policies to service_role;
revoke insert, update, delete on public.ad_campaigns, public.ad_campaign_products, public.ad_clicks
  from service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** A seller's prepaid ad balance (0 when they have never topped up). */
create or replace function public.ads_prepaid_balance(p_seller_account_id uuid, p_currency public.currency_code)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.balance_minor from public.ledger_accounts a
                    where a.kind = 'ads_prepaid' and a.currency = p_currency
                      and a.owner_seller_account_id = p_seller_account_id), 0)::bigint;
$$;

revoke all on function public.ads_prepaid_balance(uuid, public.currency_code) from public, anon, authenticated;
grant execute on function public.ads_prepaid_balance(uuid, public.currency_code) to service_role;

/** What a campaign has been billed today (UTC). */
create or replace function public.ad_campaign_spend_today(p_campaign_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.price_minor), 0)::bigint from public.ad_clicks c
   where c.campaign_id = p_campaign_id and c.click_date = (now() at time zone 'utc')::date;
$$;

revoke all on function public.ad_campaign_spend_today(uuid) from public, anon, authenticated;
grant execute on function public.ad_campaign_spend_today(uuid) to service_role;

/**
 * Moves every active campaign the seller can no longer afford a click on to
 * out_of_funds, and every out_of_funds one they now can back to active.
 * Called after anything that changes the prepaid balance, under its lock.
 */
create or replace function public.refresh_ad_campaign_funding(
  p_seller_account_id uuid,
  p_currency public.currency_code
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_balance bigint := public.ads_prepaid_balance(p_seller_account_id, p_currency);
begin
  update public.ad_campaigns
     set state = 'out_of_funds'
   where seller_account_id = p_seller_account_id and currency = p_currency
     and state = 'active' and bid_minor > v_balance;
  update public.ad_campaigns
     set state = 'active'
   where seller_account_id = p_seller_account_id and currency = p_currency
     and state = 'out_of_funds' and bid_minor <= v_balance;
end;
$$;

revoke all on function public.refresh_ad_campaign_funding(uuid, public.currency_code) from public, anon, authenticated;
grant execute on function public.refresh_ad_campaign_funding(uuid, public.currency_code) to service_role;

/**
 * Lock order for everything that touches a seller's ads money: ALL of the
 * seller's campaign rows (in id order) first, then ledger accounts. A click
 * locks its campaign and then the prepaid balance, and a top-up changes the
 * balance and then flips campaigns between active and out_of_funds; without one
 * order those two deadlock. Serialising a seller's clicks costs nothing at the
 * click rates one seller sees.
 */
create or replace function public.lock_seller_ad_campaigns(p_seller_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform 1 from public.ad_campaigns
   where seller_account_id = p_seller_account_id
   order by id
   for update;
end;
$$;

revoke all on function public.lock_seller_ad_campaigns(uuid) from public, anon, authenticated;
grant execute on function public.lock_seller_ad_campaigns(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Prepaid balance
-- ---------------------------------------------------------------------------

/**
 * Seller moves money from their available balance into ad budget.
 *
 * Refused when it would take available below zero: ad spend is never credit,
 * and a seller in arrears owes a clawback first. Keyed on the caller's
 * idempotency key, so a double-submit tops up once.
 */
create or replace function public.ads_top_up(
  p_seller_account_id uuid,
  p_amount_minor bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_country public.country_code;
  v_currency public.currency_code;
  v_min bigint;
  v_account uuid;
  v_available bigint;
  v_txn uuid;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'Enter an amount to add.';
  end if;
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception using errcode = '22023', message = 'A top-up needs an idempotency key.';
  end if;

  select sa.country, cc.currency, ap.min_top_up_minor
    into v_country, v_currency, v_min
    from public.seller_accounts sa
    join public.country_configs cc on cc.country = sa.country
    left join public.ad_policies ap on ap.country = sa.country
   where sa.id = p_seller_account_id and sa.status = 'active';
  if v_country is null then
    raise exception using errcode = '55000', message = 'Only an active shop can buy promoted listings.';
  end if;
  if v_min is null then
    raise exception using errcode = '55000', message = 'Promoted listings are not available in this market.';
  end if;

  -- Replay: same key, same seller -> the original transaction.
  select id into v_txn from public.ledger_transactions
   where event_key = 'ads_top_up:' || p_seller_account_id::text || ':' || p_idempotency_key;
  if v_txn is not null then return v_txn; end if;

  if p_amount_minor < v_min then
    raise exception using errcode = '22023', message = 'That is below the minimum top-up.';
  end if;

  perform public.lock_seller_ad_campaigns(p_seller_account_id);
  v_account := public.ledger_account_for('seller_available', v_currency, p_seller_account_id);
  select balance_minor into v_available from public.ledger_accounts where id = v_account for update;
  if v_available < p_amount_minor then
    raise exception using errcode = '55000', message = 'Not enough available balance for this top-up.';
  end if;

  v_txn := public.post_ledger_transaction(
    'ads_top_up',
    'ads_top_up:' || p_seller_account_id::text || ':' || p_idempotency_key,
    v_currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'seller_available', 'seller_account_id', p_seller_account_id,
                         'amount_minor', p_amount_minor),
      jsonb_build_object('kind', 'ads_prepaid', 'seller_account_id', p_seller_account_id,
                         'amount_minor', -p_amount_minor)),
    p_seller_account_id, null, null, null, 'Promoted listings budget added');

  perform public.refresh_ad_campaign_funding(p_seller_account_id, v_currency);
  return v_txn;
end;
$$;

revoke all on function public.ads_top_up(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.ads_top_up(uuid, bigint, text) to service_role;

/** Unused ad budget back to the seller's available balance. */
create or replace function public.ads_withdraw(
  p_seller_account_id uuid,
  p_amount_minor bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_currency public.currency_code;
  v_account uuid;
  v_balance bigint;
  v_txn uuid;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'Enter an amount to move back.';
  end if;
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception using errcode = '22023', message = 'A withdrawal needs an idempotency key.';
  end if;

  select cc.currency into v_currency
    from public.seller_accounts sa join public.country_configs cc on cc.country = sa.country
   where sa.id = p_seller_account_id;
  if v_currency is null then
    raise exception using errcode = 'P0002', message = 'Seller not found.';
  end if;

  select id into v_txn from public.ledger_transactions
   where event_key = 'ads_withdraw:' || p_seller_account_id::text || ':' || p_idempotency_key;
  if v_txn is not null then return v_txn; end if;

  perform public.lock_seller_ad_campaigns(p_seller_account_id);
  perform 1 from public.ledger_accounts
   where id = public.ledger_account_for('seller_available', v_currency, p_seller_account_id)
   for update;
  v_account := public.ledger_account_for('ads_prepaid', v_currency, p_seller_account_id);
  select balance_minor into v_balance from public.ledger_accounts where id = v_account for update;
  if v_balance < p_amount_minor then
    raise exception using errcode = '55000', message = 'That is more than your unused ad budget.';
  end if;

  v_txn := public.post_ledger_transaction(
    'ads_withdraw',
    'ads_withdraw:' || p_seller_account_id::text || ':' || p_idempotency_key,
    v_currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'ads_prepaid', 'seller_account_id', p_seller_account_id,
                         'amount_minor', p_amount_minor),
      jsonb_build_object('kind', 'seller_available', 'seller_account_id', p_seller_account_id,
                         'amount_minor', -p_amount_minor)),
    p_seller_account_id, null, null, null, 'Unused promoted listings budget returned');

  perform public.refresh_ad_campaign_funding(p_seller_account_id, v_currency);
  return v_txn;
end;
$$;

revoke all on function public.ads_withdraw(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.ads_withdraw(uuid, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- Campaign lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.validate_ad_campaign_terms(
  p_country public.country_code,
  p_daily_budget_minor bigint,
  p_bid_minor bigint
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pol public.ad_policies%rowtype;
begin
  select * into pol from public.ad_policies where country = p_country;
  if pol.country is null then
    raise exception using errcode = '55000', message = 'Promoted listings are not available in this market.';
  end if;
  if p_bid_minor is null or p_bid_minor < pol.min_bid_minor or p_bid_minor > pol.max_bid_minor then
    raise exception using errcode = '22023', message = 'The bid per click is outside the allowed range.';
  end if;
  if p_daily_budget_minor is null or p_daily_budget_minor < pol.min_daily_budget_minor
     or p_daily_budget_minor > pol.max_daily_budget_minor then
    raise exception using errcode = '22023', message = 'The daily budget is outside the allowed range.';
  end if;
  if p_daily_budget_minor < p_bid_minor then
    raise exception using errcode = '22023', message = 'The daily budget must cover at least one click.';
  end if;
end;
$$;

revoke all on function public.validate_ad_campaign_terms(public.country_code, bigint, bigint) from public, anon, authenticated;
grant execute on function public.validate_ad_campaign_terms(public.country_code, bigint, bigint) to service_role;

create or replace function public.create_ad_campaign(
  p_seller_account_id uuid,
  p_name text,
  p_product_ids uuid[],
  p_daily_budget_minor bigint,
  p_bid_minor bigint,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_country public.country_code;
  v_currency public.currency_code;
  v_max_products smallint;
  v_count integer;
  v_valid integer;
  v_id uuid;
begin
  if p_created_by is null then
    raise exception using errcode = '22023', message = 'A campaign needs the creating user.';
  end if;

  select sa.country, cc.currency, ap.max_products_per_campaign
    into v_country, v_currency, v_max_products
    from public.seller_accounts sa
    join public.country_configs cc on cc.country = sa.country
    left join public.ad_policies ap on ap.country = sa.country
   where sa.id = p_seller_account_id and sa.status = 'active';
  if v_country is null then
    raise exception using errcode = '55000', message = 'Only an active shop can promote products.';
  end if;

  perform public.validate_ad_campaign_terms(v_country, p_daily_budget_minor, p_bid_minor);

  v_count := coalesce(cardinality(array(select distinct unnest(p_product_ids))), 0);
  if v_count = 0 or v_count > v_max_products then
    raise exception using errcode = '22023',
      message = format('Choose between 1 and %s products to promote.', v_max_products);
  end if;

  -- Only live, unmoderated products in a published shop, and only this seller's.
  select count(*) into v_valid
    from public.products p
    join public.shops s on s.id = p.shop_id
   where p.id = any (p_product_ids)
     and p.seller_account_id = p_seller_account_id
     and p.status = 'active' and p.moderation_status = 'clear'
     and s.status = 'published';
  if v_valid <> v_count then
    raise exception using errcode = '22023',
      message = 'Only your own active products in a published shop can be promoted.';
  end if;

  insert into public.ad_campaigns (seller_account_id, country, currency, name,
                                   daily_budget_minor, bid_minor, state, created_by)
  values (p_seller_account_id, v_country, v_currency, btrim(p_name),
          p_daily_budget_minor, p_bid_minor,
          case when public.ads_prepaid_balance(p_seller_account_id, v_currency) >= p_bid_minor
               then 'active' else 'out_of_funds' end::public.ad_campaign_state,
          p_created_by)
  returning id into v_id;

  insert into public.ad_campaign_products (campaign_id, product_id, seller_account_id)
  select v_id, pid, p_seller_account_id from (select distinct unnest(p_product_ids) as pid) x;

  return v_id;
end;
$$;

revoke all on function public.create_ad_campaign(uuid, text, uuid[], bigint, bigint, uuid) from public, anon, authenticated;
grant execute on function public.create_ad_campaign(uuid, text, uuid[], bigint, bigint, uuid) to service_role;

/**
 * Seller changes a campaign: pause, resume, end, or new bid/budget. Resuming
 * lands in out_of_funds rather than active when the balance cannot pay a click.
 */
create or replace function public.update_ad_campaign(
  p_campaign_id uuid,
  p_seller_account_id uuid,
  p_action text,
  p_daily_budget_minor bigint default null,
  p_bid_minor bigint default null
)
returns public.ad_campaign_state
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  c public.ad_campaigns%rowtype;
  v_state public.ad_campaign_state;
begin
  perform public.lock_seller_ad_campaigns(p_seller_account_id);
  select * into c from public.ad_campaigns
   where id = p_campaign_id and seller_account_id = p_seller_account_id;
  if c.id is null then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;
  if c.state = 'ended' then
    raise exception using errcode = '55000', message = 'This campaign has ended.';
  end if;

  if p_action = 'pause' then
    v_state := 'paused';
  elsif p_action = 'end' then
    update public.ad_campaigns set state = 'ended', ended_at = now() where id = c.id;
    return 'ended';
  elsif p_action = 'resume' then
    v_state := case when public.ads_prepaid_balance(c.seller_account_id, c.currency) >= c.bid_minor
                    then 'active' else 'out_of_funds' end;
  elsif p_action = 'update_terms' then
    perform public.validate_ad_campaign_terms(c.country, p_daily_budget_minor, p_bid_minor);
    update public.ad_campaigns
       set daily_budget_minor = p_daily_budget_minor, bid_minor = p_bid_minor
     where id = c.id;
    v_state := case
      when c.state = 'paused' then 'paused'
      when public.ads_prepaid_balance(c.seller_account_id, c.currency) >= p_bid_minor then 'active'
      else 'out_of_funds' end;
  else
    raise exception using errcode = '22023', message = 'Unknown campaign action.';
  end if;

  update public.ad_campaigns set state = v_state where id = c.id;
  return v_state;
end;
$$;

revoke all on function public.update_ad_campaign(uuid, uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.update_ad_campaign(uuid, uuid, text, bigint, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Auction and clicks
-- ---------------------------------------------------------------------------

/**
 * The sponsored slots for one market right now, best first, with the price
 * each would pay per click (see header for the auction).
 *
 * A campaign is eligible when it is active, its seller is active and has the
 * promoted_listings flag, its prepaid balance covers its bid, and today's spend
 * leaves room for one more click. Each campaign shows one of its products,
 * rotated daily, that is still live, in stock and in a published shop.
 */
create or replace function public.sponsored_listings(
  p_country public.country_code,
  p_limit integer default null
)
returns table (
  campaign_id uuid,
  product_id uuid,
  seller_account_id uuid,
  product_name text,
  price_minor bigint,
  currency public.currency_code,
  shop_slug text,
  shop_name text,
  image_path text,
  bid_minor bigint,
  cost_per_click_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  pol public.ad_policies%rowtype;
  v_today date := (now() at time zone 'utc')::date;
begin
  select * into pol from public.ad_policies where country = p_country;
  if pol.country is null or pol.sponsored_slots = 0 then return; end if;

  return query
  with eligible as (
    select c.id, c.seller_account_id, c.bid_minor, c.currency, c.created_at
      from public.ad_campaigns c
      join public.seller_accounts sa on sa.id = c.seller_account_id and sa.status = 'active'
     where c.country = p_country
       and c.state = 'active'
       and public.ads_prepaid_balance(c.seller_account_id, c.currency) >= c.bid_minor
       and coalesce((select sum(k.price_minor) from public.ad_clicks k
                      where k.campaign_id = c.id and k.click_date = v_today), 0)
           + c.bid_minor <= c.daily_budget_minor
       and public.evaluate_feature_flag('promoted_listings', c.seller_account_id, null)
  ),
  with_product as (
    select distinct on (e.id)
           e.id as campaign_id, e.seller_account_id, e.bid_minor, e.currency, e.created_at,
           p.id as product_id, p.name as product_name, p.price_minor, s.slug as shop_slug,
           s.display_name as shop_name,
           (select m.object_path from public.product_media m
             where m.product_id = p.id order by m.position limit 1) as image_path
      from eligible e
      join public.ad_campaign_products cp on cp.campaign_id = e.id
      join public.products p on p.id = cp.product_id
                             and p.status = 'active' and p.moderation_status = 'clear'
                             -- A paid click must not land on a sold-out page.
                             and (p.inventory_policy <> 'track' or p.stock_quantity > p.reserved_quantity)
      join public.shops s on s.id = p.shop_id and s.status = 'published'
     order by e.id, md5(p.id::text || v_today::text)
  ),
  one_per_seller as (
    select distinct on (w.seller_account_id) w.*
      from with_product w
     order by w.seller_account_id, w.bid_minor desc, w.created_at, w.campaign_id
  ),
  ranked as (
    select o.*,
           lead(o.bid_minor) over (order by o.bid_minor desc, o.created_at, o.campaign_id) as next_bid,
           row_number() over (order by o.bid_minor desc, o.created_at, o.campaign_id) as slot
      from one_per_seller o
  )
  select r.campaign_id, r.product_id, r.seller_account_id, r.product_name, r.price_minor,
         r.currency, r.shop_slug, r.shop_name, r.image_path, r.bid_minor,
         least(r.bid_minor, greatest(pol.min_bid_minor, coalesce(r.next_bid + 1, pol.min_bid_minor)))
    from ranked r
   where r.slot <= least(coalesce(p_limit, pol.sponsored_slots), pol.sponsored_slots)
   order by r.slot;
end;
$$;

revoke all on function public.sponsored_listings(public.country_code, integer) from public, anon, authenticated;
grant execute on function public.sponsored_listings(public.country_code, integer) to service_role;

/**
 * Bills one click. The caller has already verified the signed click token and
 * filtered bots; this decides, under the campaign's row lock, whether the click
 * is billable and posts it.
 *
 * The price comes from the signed token (the auction price when the slot was
 * shown) but is capped at the campaign's CURRENT bid, so lowering a bid takes
 * effect on links already on screen.
 *
 * Outcomes: billed | duplicate | inactive | over_budget | out_of_funds. Only
 * 'billed' moves money.
 */
create or replace function public.record_ad_click(
  p_campaign_id uuid,
  p_product_id uuid,
  p_viewer_key text,
  p_price_minor bigint,
  p_placement text default 'discover'
)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  c public.ad_campaigns%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_price bigint;
  v_spent bigint;
  v_account uuid;
  v_balance bigint;
  v_click uuid;
  v_txn uuid;
begin
  if p_price_minor is null or p_price_minor <= 0 then
    raise exception using errcode = '22023', message = 'A click needs a positive price.';
  end if;

  select * into c from public.ad_campaigns where id = p_campaign_id;
  if c.id is null then return 'inactive'; end if;
  perform public.lock_seller_ad_campaigns(c.seller_account_id);
  -- Re-read under the lock: the state may have changed while we waited.
  select * into c from public.ad_campaigns where id = p_campaign_id;
  if c.state <> 'active' then return 'inactive'; end if;
  if not exists (select 1 from public.ad_campaign_products cp
                  where cp.campaign_id = c.id and cp.product_id = p_product_id) then
    return 'inactive';
  end if;

  if exists (select 1 from public.ad_clicks k
              where k.campaign_id = c.id and k.viewer_key = p_viewer_key and k.click_date = v_today) then
    return 'duplicate';
  end if;

  v_price := least(p_price_minor, c.bid_minor);

  select coalesce(sum(k.price_minor), 0)::bigint into v_spent
    from public.ad_clicks k where k.campaign_id = c.id and k.click_date = v_today;
  if v_spent + v_price > c.daily_budget_minor then return 'over_budget'; end if;

  v_account := public.ledger_account_for('ads_prepaid', c.currency, c.seller_account_id);
  select balance_minor into v_balance from public.ledger_accounts where id = v_account for update;
  if v_balance < v_price then
    perform public.refresh_ad_campaign_funding(c.seller_account_id, c.currency);
    return 'out_of_funds';
  end if;

  insert into public.ad_clicks (campaign_id, product_id, seller_account_id, currency,
                                viewer_key, click_date, price_minor, placement)
  values (c.id, p_product_id, c.seller_account_id, c.currency,
          p_viewer_key, v_today, v_price, coalesce(p_placement, 'discover'))
  on conflict (campaign_id, viewer_key, click_date) do nothing
  returning id into v_click;
  if v_click is null then return 'duplicate'; end if;

  v_txn := public.post_ledger_transaction(
    'ads_click',
    'ads_click:' || v_click::text,
    c.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'ads_prepaid', 'seller_account_id', c.seller_account_id,
                         'amount_minor', v_price),
      jsonb_build_object('kind', 'ads_revenue', 'amount_minor', -v_price)),
    c.seller_account_id, null, null, null, 'Promoted listing click',
    jsonb_build_object('campaignId', c.id, 'productId', p_product_id, 'clickId', v_click));

  update public.ad_clicks set ledger_transaction_id = v_txn where id = v_click;

  -- "Pauses at zero": once the balance cannot pay another click at its bid,
  -- the campaign leaves the auction until the seller tops up.
  perform public.refresh_ad_campaign_funding(c.seller_account_id, c.currency);
  return 'billed';
end;
$$;

revoke all on function public.record_ad_click(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_ad_click(uuid, uuid, text, bigint, text) to service_role;

-- ad_clicks.ledger_transaction_id is written once, by record_ad_click, right
-- after the insert; the table is otherwise append-only.
create or replace function public.prevent_ad_click_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.ledger_transaction_id is null and new.ledger_transaction_id is not null
     and (to_jsonb(new) - 'ledger_transaction_id') = (to_jsonb(old) - 'ledger_transaction_id') then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'Billed ad clicks are append-only.';
end;
$$;

revoke all on function public.prevent_ad_click_mutation() from public, anon, authenticated;

create trigger ad_clicks_append_only
  before update or delete on public.ad_clicks
  for each row execute function public.prevent_ad_click_mutation();

-- ---------------------------------------------------------------------------
-- Invariants for both products
-- ---------------------------------------------------------------------------

/**
 * Product-level books-agree checks, alongside check_ledger_invariants (which
 * checks the ledger against itself). Zero rows means the product tables and the
 * ledger tell the same story. Candidates to fold into check_ledger_invariants
 * so reconciliation freezes on them too (ADR-0014).
 */
create or replace function public.check_financial_product_invariants()
returns table (check_name text, detail text)
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  -- Each seller's financing_payable is exactly what was swept and not yet remitted.
  return query
  select 'financing_payable_drift',
         format('seller %s %s: ledger %s, advances %s', x.seller, x.currency, x.ledger, x.expected)
  from (
    select coalesce(l.seller, a.seller) as seller, coalesce(l.currency, a.currency) as currency,
           coalesce(l.balance, 0) as ledger, coalesce(a.expected, 0) as expected
    from (select owner_seller_account_id as seller, currency, sum(balance_minor)::bigint as balance
            from public.ledger_accounts where kind = 'financing_payable'
           group by 1, 2) l
    full join (select seller_account_id as seller, currency,
                      sum(swept_minor - remitted_minor - fee_revenue_minor)::bigint as expected
                 from public.financing_advances group by 1, 2) a
      on a.seller = l.seller and a.currency = l.currency
  ) x
  where x.ledger <> x.expected;

  return query
  select 'financing_fee_revenue_drift',
         format('%s: ledger %s, advances %s', x.currency, x.ledger, x.expected)
  from (
    select coalesce(l.currency, a.currency) as currency,
           coalesce(l.balance, 0) as ledger, coalesce(a.expected, 0) as expected
    from (select currency, sum(balance_minor)::bigint as balance from public.ledger_accounts
           where kind = 'financing_fee_revenue' group by 1) l
    full join (select currency, sum(fee_revenue_minor)::bigint as expected
                 from public.financing_advances group by 1) a on a.currency = l.currency
  ) x
  where x.ledger <> x.expected;

  -- An advance's swept total is the sum of its sweeps.
  return query
  select 'financing_sweep_drift', format('advance %s: advance %s, sweeps %s', a.id, a.swept_minor, s.total)
  from public.financing_advances a
  join (select advance_id, sum(swept_minor)::bigint as total from public.financing_sweeps group by 1) s
    on s.advance_id = a.id
  where a.swept_minor <> s.total;

  return query
  select 'financing_repaid_short', format('advance %s swept %s of %s', a.id, a.swept_minor, a.total_repayable_minor)
  from public.financing_advances a
  where a.state = 'repaid' and a.swept_minor <> a.total_repayable_minor;

  -- Every principal credited to a seller came from a disbursed advance.
  return query
  select 'financing_disbursement_drift',
         format('%s: ledger %s, advances %s', x.currency, x.ledger, x.expected)
  from (
    select coalesce(l.currency, a.currency) as currency,
           coalesce(l.total, 0) as ledger, coalesce(a.total, 0) as expected
    from (select t.currency, sum(e.amount_minor)::bigint as total
            from public.ledger_transactions t
            join public.ledger_entries e on e.transaction_id = t.id
            join public.ledger_accounts la on la.id = e.account_id and la.kind = 'partner_clearing'
           where t.kind = 'financing_disbursement' group by 1) l
    full join (select currency, sum(principal_minor)::bigint as total
                 from public.financing_advances where disbursed_at is not null group by 1) a
      on a.currency = l.currency
  ) x
  where x.ledger <> x.expected;

  -- ads_revenue is exactly the billed clicks.
  return query
  select 'ads_revenue_drift', format('%s: ledger %s, clicks %s', x.currency, x.ledger, x.expected)
  from (
    select coalesce(l.currency, k.currency) as currency,
           coalesce(l.balance, 0) as ledger, coalesce(k.total, 0) as expected
    from (select currency, sum(balance_minor)::bigint as balance from public.ledger_accounts
           where kind = 'ads_revenue' group by 1) l
    full join (select currency, sum(price_minor)::bigint as total from public.ad_clicks group by 1) k
      on k.currency = l.currency
  ) x
  where x.ledger <> x.expected;

  return query
  select 'ads_click_unposted', format('click %s', k.id)
  from public.ad_clicks k where k.ledger_transaction_id is null;

  return query
  select 'negative_financial_product_balance',
         format('%s for seller %s is %s', a.kind, a.owner_seller_account_id, a.balance_minor)
  from public.ledger_accounts a
  where a.kind in ('financing_payable', 'ads_prepaid') and a.balance_minor < 0;
end;
$$;

revoke all on function public.check_financial_product_invariants() from public, anon, authenticated;
grant execute on function public.check_financial_product_invariants() to service_role;

/**
 * Per-campaign spend and clicks for one seller's campaign list, aggregated
 * here rather than by selecting ad_clicks: a busy campaign has more clicks in a
 * day than PostgREST's db.max_rows returns, and a truncated sum would show a
 * seller less spend than they were charged.
 */
create or replace function public.seller_ad_campaign_stats(p_seller_account_id uuid)
returns table (campaign_id uuid, clicks_today bigint, spent_today_minor bigint,
               clicks_total bigint, spent_total_minor bigint)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select c.id,
         count(k.id) filter (where k.click_date = (now() at time zone 'utc')::date),
         coalesce(sum(k.price_minor) filter (where k.click_date = (now() at time zone 'utc')::date), 0)::bigint,
         count(k.id),
         coalesce(sum(k.price_minor), 0)::bigint
    from public.ad_campaigns c
    left join public.ad_clicks k on k.campaign_id = c.id
   where c.seller_account_id = p_seller_account_id
   group by c.id;
$$;

revoke all on function public.seller_ad_campaign_stats(uuid) from public, anon, authenticated;
grant execute on function public.seller_ad_campaign_stats(uuid) to service_role;
