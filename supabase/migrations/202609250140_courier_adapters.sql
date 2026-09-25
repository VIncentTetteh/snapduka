-- Courier adapters: live quotes, adapter booking, and partner credentials in
-- Vault (roadmap Phase 2, squad C).
--
-- Three tables have existed unused since the initial schema:
--   * courier_quotes    — order-scoped, so it could not cache a storefront
--                         quote, which is asked for before any order exists.
--   * courier_connections — `credentials_encrypted` is plain text that nothing
--                         encrypts: the same misnamed-column trap 202609050088
--                         removed from outbound_webhooks.
--   * shipments.provider_shipment_id — never written; adapter bookings now
--                         store the partner's booking id there.
-- Zero rows in both courier tables in every environment, so columns can change
-- shape without a backfill.

-- ── 1. SnapDuka's delivery margin ───────────────────────────────────────────
-- Per country because courier economics are per market. Default 0: turning a
-- margin on is a pricing decision, not a side effect of a deploy. Capped at
-- 50% so a typo in bps (5000 vs 500) cannot quietly double a buyer's delivery.
alter table public.country_configs
  add column delivery_margin_bps integer not null default 0;
alter table public.country_configs
  add constraint country_configs_delivery_margin_bps_check
  check (delivery_margin_bps between 0 and 5000);
comment on column public.country_configs.delivery_margin_bps is
  'SnapDuka margin added to courier quotes, in basis points of the courier price. 0 = pass-through.';

-- ── 2. courier_quotes becomes a quote cache ─────────────────────────────────
-- A storefront quote belongs to a shop and a destination, not an order, so
-- order_id becomes optional. The composite order FK is MATCH SIMPLE and skips
-- its check when order_id is null, which is exactly the storefront case.
alter table public.courier_quotes alter column order_id drop not null;

alter table public.courier_quotes
  add column shop_id uuid,
  -- sha256 of (shop, destination, parcel value, cod). Rows sharing a key are one
  -- fan-out's answers, so a cache hit returns all of them together.
  add column cache_key text,
  add column service_label text,
  add column eta_minutes integer,
  -- What SnapDuka adds on top of amount_minor (the courier's price), fixed at
  -- quote time so a margin change cannot reprice a quote a buyer already saw.
  add column margin_minor bigint not null default 0;

-- Tenant-scoped, single constraint: the shop must belong to the quote's seller.
-- No separate shop_id -> shops(id) key is added beside it (see
-- 202609050084: two FKs over overlapping columns break PostgREST embeds).
alter table public.courier_quotes
  add constraint courier_quotes_shop_same_seller
  foreign key (shop_id, seller_account_id)
  references public.shops (id, seller_account_id) on delete cascade;

alter table public.courier_quotes
  add constraint courier_quotes_amounts_check check (amount_minor >= 0 and margin_minor >= 0),
  add constraint courier_quotes_eta_check check (eta_minutes is null or eta_minutes >= 0),
  -- Something has to own the row: an order (seller booking) or a shop (storefront).
  add constraint courier_quotes_owner_check check (order_id is not null or shop_id is not null),
  add constraint courier_quotes_cache_key_check check (cache_key is null or cache_key ~ '^[0-9a-f]{64}$');

create index courier_quotes_cache_idx on public.courier_quotes (cache_key, expires_at desc)
  where cache_key is not null;
create index courier_quotes_shop_seller_idx on public.courier_quotes (shop_id, seller_account_id)
  where shop_id is not null;

-- Quotes are written by the server (service role) only. A seller able to write
-- here could plant a cheap "courier" price on their own storefront that no
-- courier will honour; reading their own quotes stays allowed.
revoke insert, update, delete on public.courier_quotes from authenticated;

-- ── 3. Shipments may be booked with the sandbox courier ─────────────────────
-- The catalogue list is copied from 202608020066 plus 'sandbox'. The sandbox
-- adapter is gated by its own flag and env switch, so this only admits a value;
-- it does not make the sandbox reachable in production.
alter table public.shipments drop constraint shipments_provider_check;
alter table public.shipments add constraint shipments_provider_check check (
  provider = any (array[
    'bolt','yango','uber','glovo','speedaf','dhl','jumia','gig','kwik','gokada',
    'self','other','manual','sandbox'
  ]::text[])
);

-- Booked through a partner API rather than recorded by the seller. The partner
-- booking id already has a home (provider_shipment_id); this records how it got
-- there, so support can tell "the courier has it" from "the seller says so".
alter table public.shipments
  add column booked_via text not null default 'seller';
alter table public.shipments
  add constraint shipments_booked_via_check check (booked_via in ('seller', 'adapter')),
  add constraint shipments_adapter_booking_id_check
    check (booked_via <> 'adapter' or provider_shipment_id is not null);

-- A partner booking id identifies one shipment. Partial: seller-recorded rows
-- never had one.
create unique index shipments_provider_booking_key
  on public.shipments (provider, provider_shipment_id)
  where provider_shipment_id is not null;

-- ── 4. Partner credentials in Vault ─────────────────────────────────────────
alter table public.courier_connections add column credentials_secret_id uuid;
comment on column public.courier_connections.credentials_secret_id is
  'vault.secrets id holding this connection''s credentials as a JSON object. Never stored here.';

-- Nothing reads it, there are no rows, and its name claims an encryption that
-- never happened.
alter table public.courier_connections drop column credentials_encrypted;

-- Sellers must not be able to point credentials_secret_id at an arbitrary vault
-- secret (internal_job_secret, say) and have the courier client send it to a
-- partner. Connections are created server-side through the function below; the
-- only column a seller may change directly is whether the connection is on.
-- Column-level grants survive a table-level revoke, so both are revoked.
revoke insert, update on public.courier_connections from authenticated;
revoke insert (id, seller_account_id, provider, active, created_at, credentials_secret_id),
       update (id, seller_account_id, provider, active, created_at, credentials_secret_id)
  on public.courier_connections from authenticated;
grant update (active) on public.courier_connections to authenticated;

-- Create or rotate a connection's credentials in one call. service_role only:
-- connecting a courier account is a server action that validates the seller's
-- role first, the same boundary as payout bank details.
create or replace function public.set_courier_connection_credentials(
  p_seller_account_id uuid,
  p_provider text,
  p_credentials jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.courier_connections;
  v_secret_id uuid;
begin
  if p_seller_account_id is null or coalesce(btrim(p_provider), '') = '' then
    raise exception using errcode = '22023', message = 'A seller and provider are required.';
  end if;
  if p_credentials is null or jsonb_typeof(p_credentials) <> 'object' or p_credentials = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Credentials must be a non-empty JSON object.';
  end if;

  insert into public.courier_connections (seller_account_id, provider, active)
  values (p_seller_account_id, p_provider, true)
  on conflict (seller_account_id, provider) do update set active = true
  returning * into v_connection;

  if v_connection.credentials_secret_id is null then
    v_secret_id := vault.create_secret(
      p_credentials::text,
      'courier_credentials:' || v_connection.id::text,
      'Courier partner credentials'
    );
    update public.courier_connections
       set credentials_secret_id = v_secret_id
     where id = v_connection.id;
  else
    perform vault.update_secret(v_connection.credentials_secret_id, p_credentials::text);
  end if;

  return v_connection.id;
end;
$$;

-- Read back for the courier client only. Returns null for an inactive
-- connection, so switching a connection off takes effect on the next call.
create or replace function public.courier_connection_credentials(
  p_seller_account_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select credentials_secret_id into v_secret_id
    from public.courier_connections
   where seller_account_id = p_seller_account_id
     and provider = p_provider
     and active;
  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_secret_id;
  return v_secret::jsonb;
end;
$$;

revoke all on function public.set_courier_connection_credentials(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_courier_connection_credentials(uuid, text, jsonb) to service_role;
revoke all on function public.courier_connection_credentials(uuid, text)
  from public, anon, authenticated;
grant execute on function public.courier_connection_credentials(uuid, text) to service_role;

-- ── 5. Expired storefront quotes are pruned daily ───────────────────────────
-- Order-scoped rows are kept (they document what a seller was offered at
-- booking); cache rows are worthless an hour after they expire.
select cron.schedule(
  'snapduka-prune-courier-quotes',
  '25 4 * * *',
  $job$delete from public.courier_quotes where order_id is null and expires_at < now() - interval '1 day'$job$
);
