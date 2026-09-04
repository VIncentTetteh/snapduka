-- supabase/migrations/202609050083_link_destination_and_anon_writes.sql
--
-- Two holes a foreign key cannot close.
--
-- 1. `campaign_links.destination_path` is free text, so no key constrains it.
--    The composite FK added in 202609050082 guarantees the link's `shop_id`
--    belongs to its seller; it says nothing about the path, which is what
--    /l/<token> actually redirects to. Web now validates it in
--    checkDestination, but mobile mints links itself — straight to PostgREST
--    with the user's JWT — so there is no server action to put a check in front
--    of. A trigger covers both clients, and psql.
--
-- 2. `restock_requests` and `abandoned_checkouts` still grant INSERT to `anon`
--    with `with check (consent)` — no tenant check whatsoever, so an
--    unauthenticated caller could write rows carrying any seller_account_id,
--    shop_id or product_id they liked. Both tables are written only by
--    api/restock and api/checkout/abandoned, which use the service-role client
--    and derive the tenant from the product or shop. The anon grant is left
--    over: push_subscriptions had exactly this shape and was closed the same
--    way in 202607210041.

-- ── 1. A tracked link may only point into its own shop ──────────────────────
create or replace function public.campaign_links_guard_destination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shop_slug text;
begin
  select slug into shop_slug from public.shops where id = new.shop_id;
  if shop_slug is null then
    raise exception using errcode = '23503', message = 'That shop does not exist.';
  end if;

  -- Either the storefront root, or something beneath it. Anything else — the
  -- app root, another seller's slug, a dashboard path — is refused.
  if new.destination_path <> '/' || shop_slug
     and new.destination_path not like '/' || shop_slug || '/%' then
    raise exception using errcode = '23514',
      message = format('A tracked link can only point into its own shop (/%s), not %s.',
                       shop_slug, new.destination_path);
  end if;

  return new;
end;
$$;

-- Note: this validates on write, not retroactively. Renaming a shop's slug
-- would leave existing links pointing at the old one — a separate defect, and
-- one this trigger would surface the moment such a link were edited.
create trigger campaign_links_guard_destination
before insert or update of destination_path, shop_id on public.campaign_links
for each row execute function public.campaign_links_guard_destination();

-- ── 2. Nothing anonymous writes a tenant column ─────────────────────────────
drop policy if exists restock_public_insert on public.restock_requests;
drop policy if exists abandoned_public_insert on public.abandoned_checkouts;

revoke insert on public.restock_requests from anon;
revoke insert on public.abandoned_checkouts from anon;
