-- Bulk discovery refresh: listings snapshot quality_score/active at save time
-- and the public read policy hides rows older than 30 days, so without a
-- periodic refresh opted-in shops silently vanish and rankings go stale.
-- Called by the internal cron route (service role only).

create or replace function public.refresh_discovery_listings()
returns integer
language plpgsql
security definer
set search_path to ''
set row_security to off
as $$
declare
  v_count integer;
begin
  insert into public.discovery_listings(shop_id,seller_account_id,slug,display_name,country,category,city,description,quality_score,active,refreshed_at)
  select s.id,s.seller_account_id,s.slug,s.display_name,s.country,p.category,p.city,p.description,
    least(100,(select count(*)*2 from public.products where shop_id=s.id and status='active')+(case when s.published_at is not null then 20 else 0 end)),
    p.opted_in and p.operator_removed_at is null and s.status='published',now()
  from public.shops s
  join public.discovery_preferences p on p.shop_id=s.id
  on conflict(shop_id) do update set
    slug=excluded.slug,
    display_name=excluded.display_name,
    country=excluded.country,
    category=excluded.category,
    city=excluded.city,
    description=excluded.description,
    quality_score=excluded.quality_score,
    active=excluded.active,
    refreshed_at=now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.refresh_discovery_listings() from public;
revoke all on function public.refresh_discovery_listings() from anon;
revoke all on function public.refresh_discovery_listings() from authenticated;
grant execute on function public.refresh_discovery_listings() to service_role;
