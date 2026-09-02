-- supabase/migrations/202609020072_campaign_link_totals.sql
--
-- Aggregate campaign click and order totals in the database.
--
-- The Share Studio and the creator links portal both ran
-- `select campaign_id, order_id, click_count from campaign_attributions` with
-- no bound and reduced the rows in JavaScript. PostgREST caps a response at
-- db.max_rows (1000), so the totals silently stopped growing past that — the
-- same defect that was already making three analytics dashboards report wrong
-- conversion rates, waiting here for the first seller to run real campaigns.
--
-- SECURITY INVOKER, like the analytics RPCs: it reads only campaign_attributions,
-- which is RLS-scoped to the caller. Sellers see their own rows through
-- attributions_owner_read and creators theirs through attributions_creator_read,
-- so the same function serves both without a caller-supplied id to forge.
--
-- A row carrying an order_id is a conversion, not a click. Counting every row
-- as a click made each order silently increment the click total too, so the
-- split is preserved here exactly as the application had it, including the
-- click_count default of 1.

create or replace function public.campaign_link_totals()
returns table (
  campaign_id uuid,
  clicks bigint,
  orders bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.campaign_id,
    coalesce(sum(coalesce(a.click_count, 1)) filter (where a.order_id is null), 0)::bigint as clicks,
    count(*) filter (where a.order_id is not null)::bigint as orders
  from public.campaign_attributions a
  group by a.campaign_id
$$;

revoke execute on function public.campaign_link_totals() from public, anon;
grant execute on function public.campaign_link_totals() to authenticated;

-- The grouped scan is the whole query, so give it an index to group on.
create index if not exists campaign_attributions_campaign_idx
  on public.campaign_attributions (campaign_id);
