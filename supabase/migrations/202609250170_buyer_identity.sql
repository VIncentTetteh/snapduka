-- One SnapDuka buyer identity across shops (flag: buyer_accounts).
--
-- Until now every buyer was a guest: an order carried a buyer_snapshot and a
-- tracking_token, and `customers` was one row per (seller, email). Nobody could
-- see their orders from two shops in one place, and every checkout started from
-- a blank form. This adds a buyer profile keyed on a VERIFIED phone number (the
-- identifier Ghanaian buyers actually have, and the one already on every order).
--
-- The one property that matters more than any feature here: a seller must never
-- see another shop's buyers. Concretely:
--   * buyer_profiles / buyer_addresses / buyer_payment_methods are owner-only.
--     There is no seller, team or operator policy on any of them, so neither a
--     direct read nor a PostgREST embed from orders/customers can reach them.
--   * orders.buyer_profile_id / customers.buyer_profile_id are opaque uuids. A
--     seller can read the uuid on their own rows (table-level select) but can
--     resolve it to nothing. See ADR-0007 for why the column is not hidden.
--   * Everything that crosses shops (claiming, linking, history, export,
--     deletion) is a SECURITY DEFINER function that resolves the caller from
--     auth.uid() and returns an explicit column list — never a table-level
--     policy on orders, which other squads keep adding seller-private columns to.
--
-- FKs are single-column and nullable on purpose: a composite FK beside an
-- existing single-column one is exactly what took the storefront down with
-- PGRST201 on 2026-09-04 (see 202609050084).

-- ── Phone normalisation ─────────────────────────────────────────────────────
-- Mirrors normalizePhoneNumber() in src/lib/auth/onboarding.ts, which is what
-- parseGuestOrder() runs before create_guest_order stores buyer_snapshot. It is
-- deliberately NOT core normalizePhone(): that one turns an unprefixed
-- "233241234567" into "+233233241234567", and older rows written by other paths
-- do contain that shape. Immutable so it can back the claim index below.
create or replace function public.buyer_normalize_phone(p_phone text, p_country text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_stripped text;
  v_digits text;
  v_code text;
begin
  if p_phone is null then
    return null;
  end if;
  v_stripped := regexp_replace(btrim(p_phone), '[^0-9+]', '', 'g');
  v_digits := regexp_replace(v_stripped, '[^0-9]', '', 'g');
  if v_digits = '' then
    return null;
  end if;
  if left(v_stripped, 1) = '+' then
    return '+' || v_digits;
  end if;
  v_code := case p_country when 'GH' then '233' when 'NG' then '234' when 'CI' then '225' end;
  if v_code is null then
    return null;
  end if;
  if left(v_digits, length(v_code)) = v_code then
    return '+' || v_digits;
  end if;
  if p_country = 'CI' then
    return '+' || v_code || v_digits;
  end if;
  return '+' || v_code || regexp_replace(v_digits, '^0', '');
end;
$$;

revoke all on function public.buyer_normalize_phone(text, text) from public, anon;
grant execute on function public.buyer_normalize_phone(text, text) to authenticated, service_role;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table public.buyer_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users (id) on delete cascade,
  -- Copied from auth.users.phone at bootstrap, and only once Supabase Auth has
  -- stamped phone_confirmed_at: this is the key orders are claimed by, so an
  -- unverified number here would let anyone claim anyone's orders.
  phone_e164 text,
  display_name text,
  locale text not null default 'en',
  default_address_id uuid,
  -- Act 843 consent to the SHARED profile: linking orders from different shops
  -- into one history. Null means "no": nothing is claimed or linked.
  consent_shared_profile_at timestamptz,
  consent_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint buyer_profiles_phone_format check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Erasure scrubs the identifiers, so only a live profile must carry them.
  constraint buyer_profiles_live_identity check (
    deleted_at is not null or (auth_user_id is not null and phone_e164 is not null)
  ),
  constraint buyer_profiles_locale_check check (locale in ('en', 'fr')),
  constraint buyer_profiles_display_name_length check (display_name is null or char_length(display_name) between 1 and 120),
  constraint buyer_profiles_consent_pair check ((consent_shared_profile_at is null) = (consent_version is null))
);

comment on table public.buyer_profiles is
  'Cross-shop buyer identity keyed on a verified phone. Owner-only: no seller, team or operator policy by design (ADR-0007).';

-- "Unique" among live profiles: after erasure the same person may sign in again
-- and get a fresh profile, which is what deletion is supposed to mean.
create unique index buyer_profiles_auth_user_live_key on public.buyer_profiles (auth_user_id) where deleted_at is null;
create unique index buyer_profiles_phone_live_key on public.buyer_profiles (phone_e164) where deleted_at is null;

create table public.buyer_addresses (
  id uuid primary key default gen_random_uuid(),
  buyer_profile_id uuid not null references public.buyer_profiles (id) on delete cascade,
  label text,
  -- Field names and limits mirror DeliveryAddress in packages/core/src/addresses
  -- (Squad C) and the checkout zod schema, so a saved address can be dropped
  -- straight into buyer_snapshot.address without a lossy conversion.
  line1 text not null,
  area text not null default '',
  city text not null,
  region text not null default '',
  country public.country_code not null,
  digital_address text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  landmark text,
  geo_source text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_addresses_label_length check (label is null or char_length(label) between 1 and 40),
  constraint buyer_addresses_line1_length check (char_length(btrim(line1)) between 1 and 200),
  constraint buyer_addresses_area_length check (char_length(area) <= 100),
  constraint buyer_addresses_city_length check (char_length(btrim(city)) between 1 and 100),
  constraint buyer_addresses_region_length check (char_length(region) <= 100),
  constraint buyer_addresses_digital_address_format check (digital_address is null or digital_address ~ '^[A-Z]{2}-[0-9]{3,4}-[0-9]{4}$'),
  constraint buyer_addresses_landmark_length check (landmark is null or char_length(landmark) <= 160),
  constraint buyer_addresses_pin_pair check ((lat is null) = (lng is null)),
  constraint buyer_addresses_lat_range check (lat is null or lat between -90 and 90),
  constraint buyer_addresses_lng_range check (lng is null or lng between -180 and 180),
  constraint buyer_addresses_geo_source_check check (geo_source in ('none', 'device', 'digital_address', 'courier'))
);

create index buyer_addresses_profile_idx on public.buyer_addresses (buyer_profile_id, created_at desc);

-- Single-column FK. NOTE for anyone embedding: buyer_profiles and
-- buyer_addresses are related in both directions, so a PostgREST embed between
-- them must name the key (buyer_addresses!buyer_addresses_buyer_profile_id_fkey).
alter table public.buyer_profiles
  add constraint buyer_profiles_default_address_id_fkey
  foreign key (default_address_id) references public.buyer_addresses (id) on delete set null;

create table public.buyer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  buyer_profile_id uuid not null references public.buyer_profiles (id) on delete cascade,
  provider text not null,
  method text not null,
  momo_network text,
  -- Display only ("024****567"). The full MSISDN lives inside the provider
  -- token; it is never stored in the clear.
  msisdn_masked text,
  card_last4 text,
  -- AES-256-GCM "v1.<iv>.<tag>.<data>", the same sealing format as
  -- social_accounts.*_token_sealed (src/lib/buyer/crypto.ts), under its own key.
  -- Never granted to clients, not even the owner: a leaked JWT must not become
  -- a leaked reusable charge authorisation.
  provider_token_sealed text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint buyer_payment_methods_provider_check check (provider in ('paystack')),
  constraint buyer_payment_methods_method_check check (method in ('momo', 'card')),
  constraint buyer_payment_methods_momo_shape check (
    (method = 'momo' and momo_network in ('mtn', 'telecel', 'airteltigo') and msisdn_masked ~ '^[0-9+*]{6,16}$' and card_last4 is null)
    or (method = 'card' and momo_network is null and msisdn_masked is null and (card_last4 is null or card_last4 ~ '^[0-9]{4}$'))
  ),
  constraint buyer_payment_methods_sealed_format check (provider_token_sealed like 'v1.%')
);

create index buyer_payment_methods_profile_idx on public.buyer_payment_methods (buyer_profile_id, last_used_at desc nulls last);

create trigger buyer_profiles_set_updated_at before update on public.buyer_profiles
  for each row execute function public.set_updated_at();
create trigger buyer_addresses_set_updated_at before update on public.buyer_addresses
  for each row execute function public.set_updated_at();

-- ── Links from existing tables ──────────────────────────────────────────────
alter table public.orders
  add column buyer_profile_id uuid references public.buyer_profiles (id) on delete set null;
alter table public.customers
  add column buyer_profile_id uuid references public.buyer_profiles (id) on delete set null;

create index orders_buyer_profile_idx on public.orders (buyer_profile_id, created_at desc)
  where buyer_profile_id is not null;
create index customers_buyer_profile_idx on public.customers (buyer_profile_id)
  where buyer_profile_id is not null;
-- What claim_guest_orders() searches: unclaimed orders by normalised phone.
create index orders_unclaimed_buyer_phone_idx on public.orders (
  public.buyer_normalize_phone(buyer_snapshot ->> 'phone', buyer_snapshot ->> 'country'),
  created_at
) where buyer_profile_id is null;

-- ── Integrity triggers ──────────────────────────────────────────────────────
-- The default address must be one of the buyer's own. RLS checks the row being
-- written, not the row a foreign id points at (snapduka-authz-boundaries), so
-- without this a buyer could point default_address_id at someone else's
-- address id and the FK alone would accept it.
create or replace function public.buyer_profiles_default_address_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if new.default_address_id is not null and not exists (
    select 1 from public.buyer_addresses a
    where a.id = new.default_address_id and a.buyer_profile_id = new.id
  ) then
    raise exception 'default address must belong to this buyer' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger buyer_profiles_default_address_guard
  before insert or update of default_address_id on public.buyer_profiles
  for each row execute function public.buyer_profiles_default_address_guard();

-- A small hard cap so a scripted client cannot fill the table.
create or replace function public.buyer_addresses_limit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if (select count(*) from public.buyer_addresses where buyer_profile_id = new.buyer_profile_id) >= 20 then
    raise exception 'address book is full' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger buyer_addresses_limit_guard
  before insert on public.buyer_addresses
  for each row execute function public.buyer_addresses_limit_guard();

revoke all on function public.buyer_profiles_default_address_guard() from public, anon, authenticated;
revoke all on function public.buyer_addresses_limit_guard() from public, anon, authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
create or replace function public.current_buyer_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select p.id from public.buyer_profiles p
  where p.auth_user_id = (select auth.uid()) and p.deleted_at is null
  limit 1
$$;

revoke all on function public.current_buyer_profile_id() from public, anon;
grant execute on function public.current_buyer_profile_id() to authenticated, service_role;

alter table public.buyer_profiles enable row level security;
alter table public.buyer_profiles force row level security;
alter table public.buyer_addresses enable row level security;
alter table public.buyer_addresses force row level security;
alter table public.buyer_payment_methods enable row level security;
alter table public.buyer_payment_methods force row level security;

revoke all on public.buyer_profiles, public.buyer_addresses, public.buyer_payment_methods
  from public, anon, authenticated;
grant all on public.buyer_profiles, public.buyer_addresses, public.buyer_payment_methods to service_role;

create policy buyer_profiles_owner_read on public.buyer_profiles
  for select to authenticated
  using (auth_user_id = (select auth.uid()) and deleted_at is null);
create policy buyer_profiles_owner_update on public.buyer_profiles
  for update to authenticated
  using (auth_user_id = (select auth.uid()) and deleted_at is null)
  with check (auth_user_id = (select auth.uid()) and deleted_at is null);
grant select on public.buyer_profiles to authenticated;
-- Phone, consent and deletion only change through the definer functions below,
-- which enforce verification and write the audit record.
grant update (display_name, locale, default_address_id) on public.buyer_profiles to authenticated;

create policy buyer_addresses_owner_all on public.buyer_addresses
  for all to authenticated
  using (buyer_profile_id = (select public.current_buyer_profile_id()))
  with check (buyer_profile_id = (select public.current_buyer_profile_id()));
grant select, insert, update, delete on public.buyer_addresses to authenticated;

create policy buyer_payment_methods_owner_read on public.buyer_payment_methods
  for select to authenticated
  using (buyer_profile_id = (select public.current_buyer_profile_id()));
create policy buyer_payment_methods_owner_delete on public.buyer_payment_methods
  for delete to authenticated
  using (buyer_profile_id = (select public.current_buyer_profile_id()));
grant select (id, buyer_profile_id, provider, method, momo_network, msisdn_masked, card_last4, last_used_at, created_at)
  on public.buyer_payment_methods to authenticated;
grant delete on public.buyer_payment_methods to authenticated;

-- ── Bootstrap ───────────────────────────────────────────────────────────────
create or replace function public.bootstrap_buyer_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_confirmed timestamptz;
  v_profile public.buyer_profiles;
  v_created boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select u.phone, u.phone_confirmed_at into v_phone, v_confirmed from auth.users u where u.id = v_uid;
  if coalesce(v_phone, '') = '' or v_confirmed is null then
    return jsonb_build_object('status', 'phone_unverified');
  end if;
  -- Supabase stores the number without the plus.
  v_phone := '+' || regexp_replace(v_phone, '[^0-9]', '', 'g');

  select * into v_profile from public.buyer_profiles
   where auth_user_id = v_uid and deleted_at is null for update;

  if not found then
    if exists (select 1 from public.buyer_profiles where phone_e164 = v_phone and deleted_at is null) then
      -- Another live profile holds this number: its owner changed their auth
      -- phone away from it. Refuse rather than guess who owns the orders.
      return jsonb_build_object('status', 'phone_in_use');
    end if;
    insert into public.buyer_profiles (auth_user_id, phone_e164)
    values (v_uid, v_phone)
    returning * into v_profile;
    v_created := true;
    perform public.write_audit_event('user', v_uid, 'buyer.profile_created', 'buyer_profile', v_profile.id);
  elsif v_profile.phone_e164 <> v_phone then
    -- The auth phone was changed (and re-verified by Supabase). Follow it, so
    -- future claims use the number the buyer can actually receive codes on.
    if exists (select 1 from public.buyer_profiles where phone_e164 = v_phone and deleted_at is null and id <> v_profile.id) then
      return jsonb_build_object('status', 'phone_in_use');
    end if;
    update public.buyer_profiles set phone_e164 = v_phone where id = v_profile.id returning * into v_profile;
    perform public.write_audit_event('user', v_uid, 'buyer.phone_changed', 'buyer_profile', v_profile.id);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'created', v_created,
    'profileId', v_profile.id,
    'phone', v_profile.phone_e164,
    'consented', v_profile.consent_shared_profile_at is not null
  );
end;
$$;

-- ── Consent ─────────────────────────────────────────────────────────────────
create or replace function public.set_buyer_shared_profile_consent(p_granted boolean, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_unlinked integer := 0;
begin
  select id into v_profile_id from public.buyer_profiles
   where auth_user_id = v_uid and deleted_at is null for update;
  if v_profile_id is null then
    return jsonb_build_object('status', 'no_profile');
  end if;

  if p_granted then
    if coalesce(btrim(p_version), '') = '' then
      raise exception 'consent version is required' using errcode = '22023';
    end if;
    update public.buyer_profiles
       set consent_shared_profile_at = now(), consent_version = btrim(p_version)
     where id = v_profile_id;
    perform public.write_audit_event('user', v_uid, 'buyer.consent_granted', 'buyer_profile', v_profile_id,
      null, null, jsonb_build_object('version', btrim(p_version)));
  else
    -- Withdrawal stops the cross-shop processing it covered: the links go too.
    -- Each order stays exactly as the seller holds it (their own record).
    update public.orders set buyer_profile_id = null where buyer_profile_id = v_profile_id;
    get diagnostics v_unlinked = row_count;
    update public.customers set buyer_profile_id = null where buyer_profile_id = v_profile_id;
    update public.buyer_profiles
       set consent_shared_profile_at = null, consent_version = null
     where id = v_profile_id;
    perform public.write_audit_event('user', v_uid, 'buyer.consent_withdrawn', 'buyer_profile', v_profile_id,
      null, null, jsonb_build_object('ordersUnlinked', v_unlinked));
  end if;

  return jsonb_build_object('status', 'ok', 'consented', p_granted, 'ordersUnlinked', v_unlinked);
end;
$$;

-- ── Claiming and linking ────────────────────────────────────────────────────
-- Internal: link a set of orders (and their per-shop customer rows, where the
-- customer's phone is the buyer's) to a profile. Callers have already proven
-- the profile owns the phone and has consented.
create or replace function public.buyer_link_orders(p_profile_id uuid, p_phone text, p_order_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_count integer;
begin
  update public.orders set buyer_profile_id = p_profile_id
   where id = any (p_order_ids) and buyer_profile_id is null;
  get diagnostics v_count = row_count;

  update public.customers c set buyer_profile_id = p_profile_id
   where c.buyer_profile_id is null
     and c.phone = p_phone
     and c.id in (select o.customer_id from public.orders o where o.id = any (p_order_ids));

  return v_count;
end;
$$;

revoke all on function public.buyer_link_orders(uuid, text, uuid[]) from public, anon, authenticated;

create or replace function public.claim_guest_orders()
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.buyer_profiles;
  v_ids uuid[];
  v_count integer;
begin
  select * into v_profile from public.buyer_profiles
   where auth_user_id = v_uid and deleted_at is null for update;
  if not found then
    return jsonb_build_object('status', 'no_profile', 'claimed', 0);
  end if;
  if v_profile.consent_shared_profile_at is null then
    return jsonb_build_object('status', 'consent_required', 'claimed', 0);
  end if;

  -- 180 days bounds both the blast radius of a recycled phone number (a SIM
  -- reissued to someone new inherits nothing older) and the scan.
  select coalesce(array_agg(o.id), '{}') into v_ids
    from public.orders o
   where o.buyer_profile_id is null
     and public.buyer_normalize_phone(o.buyer_snapshot ->> 'phone', o.buyer_snapshot ->> 'country') = v_profile.phone_e164
     and o.created_at >= now() - interval '180 days';

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('status', 'ok', 'claimed', 0);
  end if;

  v_count := public.buyer_link_orders(v_profile.id, v_profile.phone_e164, v_ids);
  perform public.write_audit_event('user', v_uid, 'buyer.guest_orders_claimed', 'buyer_profile', v_profile.id,
    null, null, jsonb_build_object('count', v_count, 'orderIds', to_jsonb(v_ids)));

  return jsonb_build_object('status', 'ok', 'claimed', v_count);
end;
$$;

-- Called by the checkout route (service role) right after create_guest_order*
-- when a signed-in buyer placed the order. The route resolves the profile from
-- the verified session; this function still re-checks everything, because a
-- service-role call is exactly where RLS will not catch a mistake.
create or replace function public.link_order_to_buyer(p_order_id uuid, p_buyer_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_profile public.buyer_profiles;
  v_order record;
  v_count integer;
begin
  select * into v_profile from public.buyer_profiles
   where id = p_buyer_profile_id and deleted_at is null;
  if not found then
    return jsonb_build_object('status', 'no_profile');
  end if;
  if v_profile.consent_shared_profile_at is null then
    return jsonb_build_object('status', 'consent_required');
  end if;

  select id, buyer_profile_id, created_at, buyer_snapshot into v_order
    from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_order.buyer_profile_id is not null then
    return jsonb_build_object('status',
      case when v_order.buyer_profile_id = p_buyer_profile_id then 'already_linked' else 'linked_elsewhere' end);
  end if;
  -- Only a just-placed order: this is a checkout hook, not a general "attach
  -- any order to any profile" primitive.
  if v_order.created_at < now() - interval '15 minutes' then
    return jsonb_build_object('status', 'too_old');
  end if;
  -- A signed-in session on a shared phone must not pull a different person's
  -- order (and delivery address) into this buyer's history. Gift orders to
  -- another number stay guest orders; the recipient can claim them.
  if public.buyer_normalize_phone(v_order.buyer_snapshot ->> 'phone', v_order.buyer_snapshot ->> 'country')
     is distinct from v_profile.phone_e164 then
    return jsonb_build_object('status', 'phone_mismatch');
  end if;

  v_count := public.buyer_link_orders(v_profile.id, v_profile.phone_e164, array[p_order_id]);
  perform public.write_audit_event('system', null, 'buyer.order_linked', 'order', p_order_id,
    null, null, jsonb_build_object('buyerProfileId', v_profile.id, 'source', 'checkout'));
  return jsonb_build_object('status', case when v_count = 1 then 'linked' else 'already_linked' end);
end;
$$;

-- ── Buyer-facing reads ──────────────────────────────────────────────────────
-- Orders are read through this, not an RLS policy on orders: the explicit
-- column list is the whole contract, and a column another squad adds to orders
-- tomorrow (seller notes, cost, fees) does not silently become buyer-visible.
create or replace function public.buyer_order_history(p_before timestamptz default null, p_limit integer default 20)
returns table (
  order_id uuid,
  public_reference text,
  tracking_token uuid,
  shop_name text,
  shop_slug text,
  status text,
  payment_status text,
  fulfillment_status text,
  total_minor bigint,
  currency text,
  item_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select o.id, o.public_reference, o.tracking_token, s.display_name, s.slug,
         o.status::text, o.payment_status::text, o.fulfillment_status::text,
         o.total_minor, o.currency::text,
         (select coalesce(sum(l.quantity), 0)::integer from public.order_lines l where l.order_id = o.id),
         o.created_at
    from public.orders o
    join public.shops s on s.id = o.shop_id
   where o.buyer_profile_id = public.current_buyer_profile_id()
     and o.buyer_profile_id is not null
     and (p_before is null or o.created_at < p_before)
   order by o.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

create or replace function public.export_buyer_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_profile public.buyer_profiles;
begin
  select * into v_profile from public.buyer_profiles
   where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'exportedAt', now(),
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'phone', v_profile.phone_e164,
      'displayName', v_profile.display_name,
      'locale', v_profile.locale,
      'sharedProfileConsentAt', v_profile.consent_shared_profile_at,
      'consentVersion', v_profile.consent_version,
      'createdAt', v_profile.created_at
    ),
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', a.label, 'line1', a.line1, 'area', a.area, 'city', a.city, 'region', a.region,
        'country', a.country, 'digitalAddress', a.digital_address, 'lat', a.lat, 'lng', a.lng,
        'landmark', a.landmark, 'createdAt', a.created_at) order by a.created_at)
      from public.buyer_addresses a where a.buyer_profile_id = v_profile.id), '[]'::jsonb),
    -- The sealed provider token is never exported: it is a charge credential,
    -- not personal data about the buyer, and it is useless outside SnapDuka.
    'paymentMethods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', m.provider, 'method', m.method, 'momoNetwork', m.momo_network,
        'msisdnMasked', m.msisdn_masked, 'cardLast4', m.card_last4,
        'lastUsedAt', m.last_used_at, 'createdAt', m.created_at) order by m.created_at)
      from public.buyer_payment_methods m where m.buyer_profile_id = v_profile.id), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', o.public_reference, 'shop', s.display_name, 'placedAt', o.created_at,
        'status', o.status, 'paymentStatus', o.payment_status, 'fulfillmentStatus', o.fulfillment_status,
        'totalMinor', o.total_minor, 'currency', o.currency,
        -- What the buyer typed at checkout — their own data, as the seller holds it.
        'buyerDetails', o.buyer_snapshot,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                    'product', l.product_name, 'variant', l.variant_name, 'quantity', l.quantity,
                    'lineTotalMinor', l.line_total_minor)), '[]'::jsonb)
                  from public.order_lines l where l.order_id = o.id)
      ) order by o.created_at desc)
      from public.orders o join public.shops s on s.id = o.shop_id
      where o.buyer_profile_id = v_profile.id), '[]'::jsonb)
  );
end;
$$;

-- ── Erasure ─────────────────────────────────────────────────────────────────
-- Not an account_deletion_requests row: that table is the seller path (NOT NULL
-- seller_account_id, one-open-request exclusion keyed on it, and "close the
-- shop" semantics). Buyer erasure can be completed immediately because nothing
-- in it is a financial record: the orders belong to the sellers who fulfilled
-- them and keep their own buyer_snapshot. The audit event is the record.
create or replace function public.request_buyer_deletion(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_unlinked integer;
begin
  select id into v_profile_id from public.buyer_profiles
   where auth_user_id = v_uid and deleted_at is null for update;
  if v_profile_id is null then
    return jsonb_build_object('status', 'no_profile');
  end if;

  update public.orders set buyer_profile_id = null where buyer_profile_id = v_profile_id;
  get diagnostics v_unlinked = row_count;
  update public.customers set buyer_profile_id = null where buyer_profile_id = v_profile_id;
  update public.buyer_profiles set default_address_id = null where id = v_profile_id;
  delete from public.buyer_payment_methods where buyer_profile_id = v_profile_id;
  delete from public.buyer_addresses where buyer_profile_id = v_profile_id;
  update public.buyer_profiles
     set deleted_at = now(), phone_e164 = null, display_name = null,
         consent_shared_profile_at = null, consent_version = null
   where id = v_profile_id;

  perform public.write_audit_event('user', v_uid, 'buyer.profile_deleted', 'buyer_profile', v_profile_id,
    null, null, jsonb_build_object('ordersUnlinked', v_unlinked, 'reason', left(p_reason, 500)));

  return jsonb_build_object('status', 'ok', 'ordersUnlinked', v_unlinked);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.bootstrap_buyer_profile() from public, anon;
revoke all on function public.set_buyer_shared_profile_consent(boolean, text) from public, anon;
revoke all on function public.claim_guest_orders() from public, anon;
revoke all on function public.link_order_to_buyer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.buyer_order_history(timestamptz, integer) from public, anon;
revoke all on function public.export_buyer_data() from public, anon;
revoke all on function public.request_buyer_deletion(text) from public, anon;

grant execute on function public.bootstrap_buyer_profile() to authenticated;
grant execute on function public.set_buyer_shared_profile_consent(boolean, text) to authenticated;
grant execute on function public.claim_guest_orders() to authenticated;
grant execute on function public.link_order_to_buyer(uuid, uuid) to service_role;
grant execute on function public.buyer_order_history(timestamptz, integer) to authenticated;
grant execute on function public.export_buyer_data() to authenticated;
grant execute on function public.request_buyer_deletion(text) to authenticated;
