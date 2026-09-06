-- Stop letting a seller type their street address into a public URL.
--
-- The storefront address was a free-text field in onboarding, defaulted from the
-- shop name but freely overridable and never editable afterwards. One live shop
-- reads `/suma-ampim-st-23` while its display name is "PurePlatter Foods": the
-- seller typed where they live, and it went into the link they share on
-- Instagram, into every tracked link, into the QR code and into the unfurl on
-- every WhatsApp forward. Nothing in the flow said the field was public, or
-- permanent.
--
-- The address now comes from the shop's own name plus a short random code. The
-- name is already the shop's public identity, so it exposes nothing new, and the
-- code removes both the "that address is taken" dead end and the free-text box
-- that invited an address in the first place.
--
-- The code needs its own column rather than being parsed back out of the slug:
-- `save_onboarding_shop` rewrites the row on every draft save, so a code derived
-- fresh each time would give the seller a different URL every time they fixed a
-- typo in their shop name.

alter table public.shops
  add column slug_code text;

comment on column public.shops.slug_code is
  'The short random suffix on the storefront address. Assigned once, never changed, so editing the shop name during onboarding does not churn the URL.';

-- Same alphabet as campaign tokens: Crockford-ish base32 without the glyphs
-- people confuse (0/O, 1/I/l, u/v), because these get read aloud over WhatsApp
-- and printed on flyers. Lowercase alphanumeric, so it satisfies
-- shops_slug_format_check on its own.
create or replace function public.generate_slug_code(p_length integer default 4)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789abcdefghjkmnpqrstvwxyz';
  v_out text := '';
  v_i integer;
begin
  for v_i in 1..p_length loop
    -- gen_random_bytes over random(): the code is the only thing keeping two
    -- shops with the same name apart, and it is guessable-by-design only if it
    -- comes from a predictable source.
    v_out := v_out || substr(v_alphabet,
      1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)), 1);
  end loop;
  return v_out;
end;
$$;

-- Backfill: every existing shop keeps the address it already has, so no live
-- link breaks. The code is recorded so a later rename lands on the same shape as
-- a new shop's.
update public.shops
set slug_code = public.generate_slug_code()
where slug_code is null;

alter table public.shops
  alter column slug_code set not null,
  alter column slug_code set default public.generate_slug_code();

alter table public.shops
  add constraint shops_slug_code_format_check check (slug_code ~ '^[a-z0-9]{4,8}$');

-- ---------------------------------------------------------------------------

/**
 * Derives a storefront address from a shop name.
 *
 * Exposed so the onboarding preview and the seller's own shop can agree on the
 * answer without restating the rule in TypeScript.
 */
create or replace function public.shop_slug_base(p_display_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_display_name, ''))), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'),
      ''),
    -- A name that is entirely punctuation slugifies to nothing. The display
    -- name check only requires two characters, and "!!" clears it.
    'shop');
$$;

-- The slug is no longer a parameter. It was the whole problem: the caller could
-- send anything, and the seller was the caller.
drop function if exists public.save_onboarding_shop(text, text, text, text);

create function public.save_onboarding_shop(
  p_display_name text,
  p_legal_name text,
  p_registration_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  seller_record public.seller_accounts%rowtype;
  shop_id uuid;
  shop_state public.shop_status;
  seller_currency public.currency_code;
  v_code text;
  v_slug text;
  v_attempt integer;
begin
  if btrim(coalesce(p_display_name, '')) = ''
    or btrim(coalesce(p_legal_name, '')) = ''
  then
    raise exception using errcode = '22023', message = 'Shop identity is incomplete.';
  end if;

  select * into seller_record
  from public.seller_accounts
  where auth_user_id = (select auth.uid())
  for update;

  if seller_record.id is null or seller_record.status not in ('pending', 'active') then
    raise exception using errcode = '42501', message = 'Seller cannot update onboarding.';
  end if;

  select status, slug_code into shop_state, v_code
  from public.shops
  where seller_account_id = seller_record.id
  for update;

  if shop_state is not null and shop_state <> 'draft' then
    raise exception using errcode = '55000',
      message = 'Only a draft shop can be changed during onboarding.';
  end if;

  select currency into seller_currency
  from public.country_configs
  where country = seller_record.country and enabled;

  -- Reused when the row already exists, so correcting a typo in the shop name
  -- re-derives the readable half without moving the seller to a new address.
  v_code := coalesce(v_code, public.generate_slug_code());

  insert into public.shops (
    seller_account_id, slug, slug_code, display_name, legal_name,
    registration_number, country, currency, status
  )
  values (
    seller_record.id,
    public.shop_slug_base(p_display_name) || '-' || v_code,
    v_code,
    btrim(p_display_name),
    btrim(p_legal_name),
    nullif(btrim(coalesce(p_registration_number, '')), ''),
    seller_record.country,
    seller_currency,
    'draft'
  )
  on conflict (seller_account_id) do update
  set slug = excluded.slug,
      slug_code = excluded.slug_code,
      display_name = excluded.display_name,
      legal_name = excluded.legal_name,
      registration_number = excluded.registration_number
  returning id into shop_id;

  return shop_id;
exception
  -- Two shops can share a name; the code is what separates them, so a collision
  -- means try another code rather than telling the seller their shop name is
  -- taken. Only the slug is retried — every other failure is a real one.
  when unique_violation then
    if position('shops_slug_key' in sqlerrm) = 0 then raise; end if;
    for v_attempt in 1..5 loop
      begin
        v_slug := public.shop_slug_base(p_display_name) || '-' || public.generate_slug_code(5);
        insert into public.shops (
          seller_account_id, slug, slug_code, display_name, legal_name,
          registration_number, country, currency, status
        )
        values (
          seller_record.id, v_slug, split_part(v_slug, '-', -1),
          btrim(p_display_name), btrim(p_legal_name),
          nullif(btrim(coalesce(p_registration_number, '')), ''),
          seller_record.country, seller_currency, 'draft'
        )
        on conflict (seller_account_id) do update
        set slug = excluded.slug,
            slug_code = excluded.slug_code,
            display_name = excluded.display_name,
            legal_name = excluded.legal_name,
            registration_number = excluded.registration_number
        returning id into shop_id;
        return shop_id;
      exception when unique_violation then
        null;
      end;
    end loop;
    raise exception using errcode = '55000',
      message = 'We could not reserve a shop address. Please try again.';
end;
$$;

grant execute on function public.save_onboarding_shop(text, text, text) to authenticated;
revoke execute on function public.generate_slug_code(integer) from public, anon;
