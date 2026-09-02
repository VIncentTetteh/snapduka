-- supabase/migrations/202609020074_creator_shop_read.sql
--
-- Let a creator read the shops they actually partner with.
--
-- The creator portal could not name a single shop. Its Shops page — whose whole
-- job is listing them — selected only the rate, hold and status, so a creator
-- working with three shops saw three identical anonymous cards. Naming them
-- needs a join, and a join needs read access.
--
-- shops_public_read already exposes published shops to anyone, so this policy is
-- only load-bearing for a partner shop that is unpublished or suspended: without
-- it that shop would silently render with no name at all, which is worse than
-- the problem being fixed.
--
-- Read-only, additive, and narrower than the public policy it supplements.
-- current_creator_id() resolves from auth.uid() independently of any seller
-- account, so it works for a user who is both a seller and a creator. Note it
-- only matches creators whose status is 'active'.

create policy shops_creator_partner_read on public.shops
  for select to authenticated using (exists (
    select 1 from public.creator_partnerships p
    where p.seller_account_id = shops.seller_account_id
      and p.creator_id = (select public.current_creator_id())));
