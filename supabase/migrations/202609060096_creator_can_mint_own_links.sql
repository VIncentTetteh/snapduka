-- Let a creator create their own tracked links.
--
-- Until now `campaign_links_creator_read` was SELECT only, so the only path that
-- could mint a creator link was `createCreatorLink` in the seller's dashboard —
-- seller-only, behind the `campaigns.manage` permission and a paid plan, and
-- hardcoded to `destination_path = '/' || shop.slug`.
--
-- Two consequences, and together they are why the programme has never completed
-- a cycle in production (2 invitations sent, 0 accepted, 1 of 17 links attached
-- to a creator):
--
--   * An influencer who accepts an invitation lands on a page that tells them
--     "The shop creates your link. Ask them for one." Their ability to earn
--     anything is blocked on a human remembering to press a button in a web
--     dashboard and then sending them the URL out of band.
--   * Every creator link points at the shop homepage. An influencer posting
--     about one product cannot link to that product, which is the whole job.
--
-- The policy is deliberately narrow, and most of the narrowing already exists:
--
--   * `campaign_links_shop_same_seller` (202609050082) forces shop_id and
--     seller_account_id to agree, so the row cannot straddle two tenants.
--   * `campaign_links_guard_destination` (202609050083) rejects any
--     destination_path outside that shop's own slug, so a creator cannot aim a
--     link at a competitor's storefront or at a dashboard route.
--
-- So all this needs to add is: the row belongs to a partnership that is mine and
-- currently active, and its seller is that partnership's seller.
-- `seller_account_operable` is included for the same reason every other write
-- policy carries it — a suspended shop should not gain new links, whoever asks.
-- `status = 'active'` is what makes a seller pausing a partnership actually stop
-- the creator, rather than only stopping accrual after the fact.
--
-- The row still carries the SELLER's seller_account_id, not the creator's: a
-- creator has no seller account, and the link belongs to the shop being
-- promoted. That is what keeps the tenant keys, the seller's own analytics and
-- `campaign_link_totals` working unchanged.
--
-- INSERT only. Nothing in either client updates campaign_links today, so a
-- creator-facing UPDATE policy would be write surface with no caller.

-- First, `seller_account_operable` has to recognise a creator.
--
-- 202609060095 narrowed it to accounts the caller belongs to, so that a signed-in
-- user could not use it to probe whether an arbitrary shop had been suspended.
-- It tests for the account owner or an active team member — and a creator is
-- neither. Verified against production: a creator asking about the shop they are
-- actively partnered with got `false`, which would have blocked every insert the
-- policy below is meant to allow.
--
-- An active partnership is exactly the kind of relationship that check is for, so
-- it joins the list. A stranger still gets false, so the probe stays closed.
create or replace function public.seller_account_operable(p_seller_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.seller_accounts sa
    where sa.id = p_seller_account_id
      and sa.status = any (array['pending'::public.seller_account_status,
                                 'active'::public.seller_account_status])
      and (
        sa.auth_user_id = (select auth.uid())
        or exists (
          select 1 from public.team_memberships tm
          where tm.seller_account_id = sa.id
            and tm.auth_user_id = (select auth.uid())
            and tm.active
        )
        or exists (
          select 1
          from public.creator_partnerships p
          join public.creators c on c.id = p.creator_id
          where p.seller_account_id = sa.id
            and p.status = 'active'
            and c.auth_user_id = (select auth.uid())
            and c.status = 'active'
        )
      )
  );
$$;

comment on function public.seller_account_operable(uuid) is
  'True when the caller belongs to this account — as owner, active team member, or active creator partner — and it may still be operated. Returns false for an account the caller has no part in, so it cannot be used to probe another seller''s status.';

create policy campaign_links_creator_insert on public.campaign_links
  as permissive for insert to authenticated
  with check (
    exists (
      select 1
      from public.creator_partnerships p
      join public.shops s on s.seller_account_id = p.seller_account_id
      where p.id = campaign_links.creator_partnership_id
        and p.creator_id = (select public.current_creator_id())
        and p.status = 'active'
        and campaign_links.seller_account_id = p.seller_account_id
        and campaign_links.shop_id = s.id
    )
    and public.seller_account_operable(campaign_links.seller_account_id)
  );
