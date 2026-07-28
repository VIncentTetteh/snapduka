-- Campaign attribution integrity.
--
-- Attribution was built for analytics, where an over-counted click is a
-- cosmetic problem. Creator commission turns the same rows into a claim on
-- money, which makes every existing weakness adversarial:
--
--   * /l/{token} inserted a row on EVERY GET, so WhatsApp and Facebook link
--     preview crawlers inflated the number a creator is paid on.
--   * The click row and the conversion row were never joined, so a payout
--     could not be traced back to a real click.
--   * anon could read every seller's active campaign links, i.e. enumerate
--     every creator's token on the platform.

-- One open click row per browser per link, instead of one per HTTP request.
alter table public.campaign_attributions
  add column visitor_key text,
  add column click_count integer not null default 1 check (click_count > 0),
  add column last_seen_at timestamptz not null default now(),
  add column source text not null default 'link'
    check (source in ('link', 'query', 'fallback'));

comment on column public.campaign_attributions.visitor_key is
  'Browser-scoped dedupe key from the sd_vid cookie, or an HMAC of ip+ua+campaign when cookies are blocked. Never a raw IP.';
comment on column public.campaign_attributions.source is
  'link = resolved from the signed sd_attr cookie; query = ?campaign= only; fallback = conversion with no matching click row.';

-- Conversion rows (order_id not null) are excluded so a converted click never
-- blocks the same browser from clicking the link again later.
create unique index campaign_attributions_open_click_key
  on public.campaign_attributions (campaign_id, visitor_key)
  where order_id is null and visitor_key is not null;

create index campaign_attributions_campaign_converted_idx
  on public.campaign_attributions (campaign_id, converted_at desc)
  where order_id is not null;

-- Tokens were `Math.random().toString(36).slice(2, 6)` — a ~1.7M keyspace on a
-- globally unique column. Verified against production: all existing rows pass.
alter table public.campaign_links
  add constraint campaign_links_token_shape_check
  check (token ~ '^[a-z0-9][a-z0-9-]{3,63}$');

-- Nothing needs anon read here: /l/[token] resolves with the service-role admin
-- client and create_guest_order_growth is security definer. The policy only
-- ever exposed every seller's tokens to anyone who asked.
drop policy campaigns_public_read on public.campaign_links;
revoke select on public.campaign_links from anon;
