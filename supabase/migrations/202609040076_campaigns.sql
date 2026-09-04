-- supabase/migrations/202609040076_campaigns.sql
--
-- Campaigns.
--
-- Until now a "campaign" was not a thing that existed. What the dashboard
-- listed was one `campaign_links` row per channel, sharing a 6-character token
-- prefix and named "<label> · <channel>" — so "Storefront · instagram" and
-- "Storefront · tiktok" were one campaign wearing two rows, with nothing to
-- name it, date it, budget it, or add up.
--
-- This adds the missing entity and hangs the existing links off it.
--
-- ⚠ Naming: `campaign_attributions.campaign_id` references **campaign_links**,
-- not this new table. That misnomer predates campaigns existing and is
-- load-bearing in create_guest_order_growth, the creator commission trigger and
-- three indexes, so it is documented rather than renamed. A join of
-- `attributions.campaign_id = links.campaign_id` would compile and be silently
-- wrong; go through `campaign_links.id`.

create type public.campaign_status as enum ('draft', 'active', 'paused', 'ended');

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Free text on purpose: "sell 40 wrappers before Christmas" is a better goal
  -- than anything a dropdown of objectives would have offered.
  objective text check (objective is null or char_length(objective) <= 500),
  status public.campaign_status not null default 'draft',
  starts_at date,
  ends_at date,
  -- Both entered by hand. SnapDuka has no ad-platform integration, so spend is
  -- what the seller says they spent.
  budget_minor bigint check (budget_minor is null or budget_minor >= 0),
  spend_minor bigint not null default 0 check (spend_minor >= 0),
  creative_path text,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_dates_ordered check (
    starts_at is null or ends_at is null or ends_at >= starts_at
  )
);

create index campaigns_seller_idx on public.campaigns (seller_account_id, created_at desc);
create index campaigns_shop_idx on public.campaigns (shop_id);

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

-- What the campaign is promoting. A campaign with no products is still valid —
-- a storefront-wide push promotes everything.
create table public.campaign_products (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, product_id)
);

create index campaign_products_product_idx on public.campaign_products (product_id);

-- Nullable, and that matters: a creator's link belongs to a partnership, not to
-- a marketing campaign, and must stay unattached. So must any link a seller
-- mints outside a campaign.
alter table public.campaign_links
  add column campaign_id uuid references public.campaigns(id) on delete set null;

create index campaign_links_campaign_idx
  on public.campaign_links (campaign_id) where campaign_id is not null;

comment on column public.campaign_links.campaign_id is
  'The campaign this link belongs to. Null for creator links and standalone links.';
comment on column public.campaign_attributions.campaign_id is
  'MISNOMER: references campaign_links(id), not campaigns(id). Predates campaigns existing.';

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Share Studio mints one link per channel as `<base>-<t|i|s|w>`, so the token
-- prefix already identifies the campaign; it just never had a row. Links that
-- do not carry a channel suffix group alone. Creator links are excluded.
with grouped as (
  select
    seller_account_id,
    shop_id,
    case when token ~ '-[itsw]$' then regexp_replace(token, '-[itsw]$', '') else token end as group_key,
    -- "Storefront · instagram" → "Storefront"
    min(split_part(name, ' · ', 1)) as name,
    min(created_at) as created_at
  from public.campaign_links
  where creator_partnership_id is null
  group by 1, 2, 3
),
created as (
  insert into public.campaigns (seller_account_id, shop_id, name, status, created_at)
  select
    seller_account_id,
    shop_id,
    -- A link named with no stem would violate the name CHECK.
    coalesce(nullif(btrim(name), ''), 'Untitled campaign'),
    'active',
    created_at
  from grouped
  returning id, seller_account_id, shop_id, name, created_at
)
update public.campaign_links l
set campaign_id = c.id
from grouped g
join created c
  on c.seller_account_id = g.seller_account_id
 and c.shop_id = g.shop_id
 and c.created_at = g.created_at
 and c.name = coalesce(nullif(btrim(g.name), ''), 'Untitled campaign')
where l.creator_partnership_id is null
  and l.seller_account_id = g.seller_account_id
  and l.shop_id = g.shop_id
  and (case when l.token ~ '-[itsw]$' then regexp_replace(l.token, '-[itsw]$', '') else l.token end) = g.group_key;

alter table public.campaigns enable row level security;
alter table public.campaign_products enable row level security;

-- Mirrors campaigns_owner_all on campaign_links.
create policy campaigns_owner_all on public.campaigns
for all to authenticated
using (seller_account_id = (select public.current_seller_account_id()))
with check (seller_account_id = (select public.current_seller_account_id()));

create policy campaign_products_owner_all on public.campaign_products
for all to authenticated
using (seller_account_id = (select public.current_seller_account_id()))
with check (seller_account_id = (select public.current_seller_account_id()));

grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.campaign_products to authenticated;
grant all on public.campaigns to service_role;
grant all on public.campaign_products to service_role;

/**
 * Clicks, orders and revenue per campaign.
 *
 * SECURITY INVOKER, exactly like campaign_link_totals(), and for the same
 * reason: it takes no account id, so RLS is the only thing scoping it to the
 * caller. As SECURITY DEFINER it would hand any authenticated caller every
 * seller's campaign performance. 037_campaign_link_totals.test.sql asserts that
 * property for the sibling function; 040 asserts it for this one.
 *
 * A row carrying an order_id is a conversion, not a click — counting every row
 * as a click is the bug the application-side split used to exist to avoid.
 */
create or replace function public.campaign_totals()
returns table (campaign_id uuid, clicks bigint, orders bigint, revenue_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.campaign_id,
    coalesce(sum(coalesce(a.click_count, 1)) filter (where a.order_id is null), 0)::bigint as clicks,
    count(*) filter (where a.order_id is not null)::bigint as orders,
    coalesce(
      sum(o.total_minor) filter (where o.payment_status in ('paid', 'partially_refunded')),
      0
    )::bigint as revenue_minor
  from public.campaign_links l
  join public.campaign_attributions a on a.campaign_id = l.id
  left join public.orders o on o.id = a.order_id
  where l.campaign_id is not null
  group by l.campaign_id
$$;

revoke execute on function public.campaign_totals() from public, anon;
grant execute on function public.campaign_totals() to authenticated;
