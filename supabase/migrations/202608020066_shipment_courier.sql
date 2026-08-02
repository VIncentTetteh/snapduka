-- Let a seller name the courier, and let the buyer see it.
--
-- shipments.provider has been free text with no constraint since
-- 202606130018_couriers.sql, and in practice always the literal 'manual' —
-- /api/couriers/book pinned it with z.literal("manual"). So the buyer's order
-- page could only ever show a bare tracking number: no indication whether the
-- parcel is with Bolt, Yango, or the seller's own rider.
--
-- provider now carries a key from src/lib/couriers/catalogue.ts, and
-- provider_name carries the label the buyer is shown.

alter table public.shipments
  add column provider_name text;

comment on column public.shipments.provider_name is
  'What the buyer is told: the catalogue label for a known courier, or the seller''s own text for ''other''. Snapshotted rather than derived so renaming a catalogue entry never rewrites what past buyers were shown.';

-- Constrain what was unbounded free text. 'manual' is retained because every
-- shipment booked before this migration has it, and those rows must keep
-- rendering.
alter table public.shipments
  add constraint shipments_provider_check check (provider in (
    'bolt', 'yango', 'uber', 'glovo', 'speedaf', 'dhl', 'jumia',
    'gig', 'kwik', 'gokada', 'self', 'other', 'manual'
  ));

-- 'other' means "a courier we do not list", which is meaningless without a
-- name. Mirrors the paired-nullability check on video_url/video_provider in
-- 202607180031_product_video.sql.
alter table public.shipments
  add constraint shipments_other_provider_named_check
  check (provider <> 'other' or (provider_name is not null and btrim(provider_name) <> ''));

-- shipments never got the trigger every other mutable table has, so updated_at
-- was frozen at insert forever. It matters now that a seller can correct a
-- mistyped tracking number.
create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

-- 202606130017_teams.sql gave fulfillment_methods team policies and skipped
-- shipments entirely, so staff whose whole job is fulfilment could not read the
-- deliveries they arrange. Read-only: booking still belongs to whoever holds
-- orders.manage, which the route already checks.
create policy shipments_team_read on public.shipments
for select to authenticated using (
  (select public.team_has_role(seller_account_id, array['manager','fulfillment','support']::public.team_role[]))
);
