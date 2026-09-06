-- Give every existing destination the "other" link it has been missing.
--
-- `SHARE_CHANNELS` gained an "other" channel because a long list of surfaces
-- that promise attribution were handing out the plain storefront URL instead:
-- the caption panel, the Posts textarea, the QR code, the "Share to WhatsApp
-- Status" link, the X / Facebook / Telegram intents, and the phone's native
-- share sheet. Every one of them asked for `linkFor("other")`, "other" was not a
-- channel, and the lookup quietly fell through to the untracked URL. Those
-- clicks were never counted.
--
-- Both minting paths skip channels that already exist, so pressing "generate"
-- again would top a destination up — but no seller knows to do that, and the
-- links already posted are the ones that matter. This mints the missing row for
-- the destinations that exist today, reusing each group's own base token so the
-- new link is recognisably a sibling of the ones beside it.
--
-- Grouped by campaign and partnership as well as destination, because one
-- product can legitimately hold two link sets under two campaigns, and a
-- creator's links for a shop are a separate set from the seller's own.

insert into public.campaign_links
  (seller_account_id, shop_id, campaign_id, creator_partnership_id,
   name, token, channel, destination_path, active)
select
  g.seller_account_id,
  g.shop_id,
  g.campaign_id,
  g.creator_partnership_id,
  -- The existing names are "<label> · <channel>"; keep the label and the shape.
  split_part(g.sample_name, ' · ', 1) || ' · other',
  g.base || '-o',
  'other',
  g.destination_path,
  true
from (
  select
    seller_account_id,
    shop_id,
    campaign_id,
    creator_partnership_id,
    destination_path,
    min(split_part(token, '-', 1)) as base,
    min(name) as sample_name
  from public.campaign_links
  where active
  group by 1, 2, 3, 4, 5
  having count(*) filter (where channel = 'other') = 0
) g
-- A base token is per-destination, so `<base>-o` is free unless two groups were
-- minted from the same base. Skipping is right either way: the point is that
-- every destination ends up with an "other" link, not that this statement is the
-- one that created it.
on conflict (token) do nothing;
