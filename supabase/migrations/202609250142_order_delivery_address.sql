-- A normalised, structured delivery address on every new order.
--
-- `buyer_snapshot.address` is four free-text strings (line1/area/city/region).
-- Couriers need more — a GhanaPostGPS code, a map pin, a landmark — and the
-- storefront checkout now collects those optionally, inside the same address
-- object. This adds `orders.delivery_address`, the cleaned copy couriers and
-- sellers read.
--
-- Why a trigger rather than a change to create_guest_order: that RPC computes
-- totals, reserves stock and records the payment method. Editing it to add an
-- address column puts every one of those at risk for a change that touches
-- none of them. A BEFORE INSERT trigger reads what the RPC already stores
-- (buyer_snapshot is p_buyer verbatim) and derives the column, so every path
-- that creates an order — the storefront, the WhatsApp checkout link, a future
-- mobile path — gets it for free, and the RPC is untouched.
--
-- buyer_snapshot stays exactly as it was for backwards compatibility: receipts,
-- notifications and the mobile app all read it.
--
-- No backfill. Updating every historical order would bump updated_at on all of
-- them for no buyer-visible gain, and the read side (src/lib/addresses/snapshot.ts)
-- falls back to buyer_snapshot for rows this never touched.

alter table public.orders add column delivery_address jsonb;

alter table public.orders add constraint orders_delivery_address_check
  check (delivery_address is null or jsonb_typeof(delivery_address) = 'object');

comment on column public.orders.delivery_address is
  'Normalised delivery address (packages/core/src/addresses/types.ts DeliveryAddress), derived from buyer_snapshot.address at insert. Null for orders placed before 202609250142 or with no address.';

-- ── The normaliser ──────────────────────────────────────────────────────────
-- Everything in buyer_snapshot is buyer input, so nothing is trusted: strings
-- are type-checked and bounded, a pin needs both halves inside the planet, and
-- a digital address must match the GhanaPostGPS shape (mirrors
-- packages/core/src/addresses/ghanapost.ts, including its region letters —
-- which carry the same NEEDS VERIFICATION caveat).
create or replace function public.normalize_delivery_address(p_address jsonb, p_country text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text_keys constant text[] := array['line1', 'area', 'city', 'region'];
  v_limits constant int[] := array[200, 100, 100, 100];
  v_out jsonb := '{}'::jsonb;
  v_value text;
  v_code text;
  v_match text[];
  v_lat numeric;
  v_lng numeric;
  i int;
begin
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    return null;
  end if;

  for i in 1 .. array_length(v_text_keys, 1) loop
    v_value := case when jsonb_typeof(p_address -> v_text_keys[i]) = 'string'
                    then left(btrim(p_address ->> v_text_keys[i]), v_limits[i]) else '' end;
    v_out := v_out || jsonb_build_object(v_text_keys[i], v_value);
  end loop;

  v_out := v_out || jsonb_build_object('country',
    case when p_country in ('GH', 'NG', 'CI') then p_country else null end);

  -- GhanaPostGPS: Ghana only, shape-checked, stored in canonical form.
  v_code := null;
  if p_country = 'GH' and jsonb_typeof(p_address -> 'digitalAddress') = 'string' then
    v_match := regexp_match(
      upper(regexp_replace(btrim(p_address ->> 'digitalAddress'), '\s+', ' ', 'g')),
      '^([A-Z])([A-Z])[-\s]*([0-9]{3,4})[-\s]*([0-9]{4})$'
    );
    if v_match is not null and v_match[1] = any (array['A','B','C','E','G','N','U','V','W','X']) then
      v_code := v_match[1] || v_match[2] || '-' || v_match[3] || '-' || v_match[4];
    end if;
  end if;
  v_out := v_out || jsonb_build_object('digitalAddress', v_code);

  v_out := v_out || jsonb_build_object('landmark',
    case when jsonb_typeof(p_address -> 'landmark') = 'string'
              and btrim(p_address ->> 'landmark') <> ''
         then left(btrim(p_address ->> 'landmark'), 160) else null end);

  -- A pin is both halves or neither: a latitude alone locates nothing.
  if jsonb_typeof(p_address -> 'lat') = 'number' and jsonb_typeof(p_address -> 'lng') = 'number' then
    v_lat := (p_address ->> 'lat')::numeric;
    v_lng := (p_address ->> 'lng')::numeric;
    if v_lat between -90 and 90 and v_lng between -180 and 180 then
      v_out := v_out || jsonb_build_object(
        'lat', round(v_lat, 6), 'lng', round(v_lng, 6), 'geoSource', 'device');
    else
      v_lat := null;
    end if;
  else
    v_lat := null;
  end if;
  if v_lat is null then
    v_out := v_out || jsonb_build_object('lat', null, 'lng', null, 'geoSource', 'none');
  end if;

  -- An address with nothing usable in it is no address.
  if coalesce(v_out ->> 'line1', '') = '' and coalesce(v_out ->> 'city', '') = ''
     and v_code is null and v_lat is null then
    return null;
  end if;
  return v_out;
end;
$$;

revoke all on function public.normalize_delivery_address(jsonb, text) from public, anon, authenticated;
grant execute on function public.normalize_delivery_address(jsonb, text) to service_role;

create or replace function public.orders_derive_delivery_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.delivery_address is null then
    begin
      new.delivery_address := public.normalize_delivery_address(
        new.buyer_snapshot -> 'address',
        new.buyer_snapshot ->> 'country'
      );
    exception when others then
      -- An address we cannot parse must never cost the seller the order. The
      -- snapshot still has what the buyer typed; the read side falls back to it.
      raise warning 'orders_derive_delivery_address: % %', sqlstate, sqlerrm;
      new.delivery_address := null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.orders_derive_delivery_address() from public, anon, authenticated;

create trigger orders_derive_delivery_address
  before insert on public.orders
  for each row execute function public.orders_derive_delivery_address();
