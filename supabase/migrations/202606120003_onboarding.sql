create function public.jsonb_has_sensitive_account_key(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  entry record;
  normalized_key text;
begin
  if jsonb_typeof(p_value) = 'object' then
    for entry in select key, value from jsonb_each(p_value)
    loop
      normalized_key := regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g');

      if normalized_key in (
        'accountnumber',
        'bankaccountnumber',
        'accountno',
        'bankaccountno'
      ) then
        return true;
      end if;

      if jsonb_typeof(entry.value) in ('object', 'array')
        and public.jsonb_has_sensitive_account_key(entry.value)
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for entry in select value from jsonb_array_elements(p_value)
    loop
      if jsonb_typeof(entry.value) in ('object', 'array')
        and public.jsonb_has_sensitive_account_key(entry.value)
      then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create table public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null,
  policy_key text not null,
  policy_version text not null,
  accepted_by_user_id uuid not null default auth.uid(),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint policy_acceptances_seller_policy_version_key
    unique (seller_account_id, policy_key, policy_version),
  constraint policy_acceptances_seller_account_id_fkey
    foreign key (seller_account_id)
    references public.seller_accounts (id)
    on delete cascade,
  constraint policy_acceptances_accepted_by_user_id_fkey
    foreign key (accepted_by_user_id)
    references auth.users (id)
    on delete cascade,
  constraint policy_acceptances_policy_key_check
    check (policy_key ~ '^[a-z][a-z0-9_]*$'),
  constraint policy_acceptances_policy_version_check
    check (btrim(policy_version) <> '')
);

create index policy_acceptances_seller_accepted_at_idx
  on public.policy_acceptances (seller_account_id, accepted_at desc);

create table public.settlement_profiles (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null,
  provider text not null default 'paystack',
  bank_code text not null,
  bank_name text not null,
  account_last4 text not null,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_profiles_seller_provider_key
    unique (seller_account_id, provider),
  constraint settlement_profiles_seller_account_id_fkey
    foreign key (seller_account_id)
    references public.seller_accounts (id)
    on delete cascade,
  constraint settlement_profiles_provider_check
    check (provider = 'paystack'),
  constraint settlement_profiles_bank_code_check
    check (btrim(bank_code) <> ''),
  constraint settlement_profiles_bank_name_check
    check (btrim(bank_name) <> ''),
  constraint settlement_profiles_account_last4_check
    check (account_last4 ~ '^[0-9]{4}$'),
  constraint settlement_profiles_status_check
    check (status in ('pending', 'active')),
  constraint settlement_profiles_metadata_check
    check (
      jsonb_typeof(metadata) = 'object'
      and not public.jsonb_has_sensitive_account_key(metadata)
    )
);

create index settlement_profiles_status_idx
  on public.settlement_profiles (status);

alter table public.payment_subaccounts
  add constraint payment_subaccounts_sensitive_metadata_check
  check (not public.jsonb_has_sensitive_account_key(metadata));

create trigger settlement_profiles_set_updated_at
before update on public.settlement_profiles
for each row execute function public.set_updated_at();

create function public.bootstrap_seller_account(
  p_auth_user_id uuid,
  p_country public.country_code,
  p_contact_name text,
  p_contact_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  verified_email text;
  seller_id uuid;
begin
  select lower(email)
  into verified_email
  from auth.users
  where id = p_auth_user_id
    and email_confirmed_at is not null;

  if verified_email is null then
    raise exception using
      errcode = '42501',
      message = 'A verified auth email is required.';
  end if;

  insert into public.seller_accounts (
    auth_user_id,
    country,
    status,
    is_active,
    contact_name,
    contact_email,
    contact_phone
  )
  values (
    p_auth_user_id,
    p_country,
    'pending',
    false,
    btrim(p_contact_name),
    verified_email,
    p_contact_phone
  )
  on conflict (auth_user_id) do update
  set auth_user_id = excluded.auth_user_id
  returning id into seller_id;

  insert into public.seller_verifications (
    seller_account_id,
    state,
    metadata
  )
  values (
    seller_id,
    'not_started',
    '{}'::jsonb
  )
  on conflict (seller_account_id) do nothing;

  return seller_id;
end;
$$;

create function public.save_onboarding_shop(
  p_slug text,
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
  normalized_slug text;
  seller_record public.seller_accounts%rowtype;
  shop_id uuid;
  shop_state public.shop_status;
  seller_currency public.currency_code;
begin
  normalized_slug := regexp_replace(lower(btrim(p_slug)), '[^a-z0-9]+', '-', 'g');
  normalized_slug := regexp_replace(normalized_slug, '(^-+|-+$)', '', 'g');

  if normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception using
      errcode = '22023',
      message = 'Invalid shop slug.';
  end if;

  if btrim(coalesce(p_display_name, '')) = ''
    or btrim(coalesce(p_legal_name, '')) = ''
  then
    raise exception using
      errcode = '22023',
      message = 'Shop identity is incomplete.';
  end if;

  select *
  into seller_record
  from public.seller_accounts
  where auth_user_id = auth.uid()
  for update;

  if seller_record.id is null
    or seller_record.status not in ('pending', 'active')
  then
    raise exception using
      errcode = '42501',
      message = 'Seller cannot update onboarding.';
  end if;

  select status
  into shop_state
  from public.shops
  where seller_account_id = seller_record.id
  for update;

  if shop_state is not null and shop_state <> 'draft' then
    raise exception using
      errcode = '55000',
      message = 'Only a draft shop can be changed during onboarding.';
  end if;

  select currency
  into seller_currency
  from public.country_configs
  where country = seller_record.country
    and enabled;

  insert into public.shops (
    seller_account_id,
    slug,
    display_name,
    legal_name,
    registration_number,
    country,
    currency,
    status
  )
  values (
    seller_record.id,
    normalized_slug,
    btrim(p_display_name),
    btrim(p_legal_name),
    nullif(btrim(coalesce(p_registration_number, '')), ''),
    seller_record.country,
    seller_currency,
    'draft'
  )
  on conflict (seller_account_id) do update
  set
    slug = excluded.slug,
    display_name = excluded.display_name,
    legal_name = excluded.legal_name,
    registration_number = excluded.registration_number
  returning id into shop_id;

  return shop_id;
end;
$$;

create function public.reserve_payment_subaccount_request(
  p_auth_user_id uuid,
  p_seller_account_id uuid,
  p_request_fingerprint text,
  p_metadata jsonb
)
returns table (
  reservation_status text,
  reservation_id uuid,
  provider_subaccount_id text,
  provider_subaccount_code text,
  provider_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  inserted_id uuid;
  existing_record public.payment_subaccounts%rowtype;
  seller_record public.seller_accounts%rowtype;
  settlement_record public.settlement_profiles%rowtype;
begin
  if btrim(coalesce(p_request_fingerprint, '')) = ''
    or jsonb_typeof(p_metadata) <> 'object'
    or public.jsonb_has_sensitive_account_key(p_metadata)
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid payment reservation.';
  end if;

  select *
  into seller_record
  from public.seller_accounts
  where id = p_seller_account_id;

  if seller_record.id is null
    or seller_record.auth_user_id <> p_auth_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'Payment seller ownership mismatch.';
  end if;

  if seller_record.status not in ('pending', 'active') then
    raise exception using
      errcode = '55000',
      message = 'Seller account is not eligible for payment setup.';
  end if;

  if not exists (
    select 1
    from public.policy_acceptances
    where seller_account_id = seller_record.id
      and policy_key = 'seller_terms'
      and policy_version = '2026-06-12'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Current seller policy acceptance is required.';
  end if;

  if not exists (
    select 1
    from public.seller_verifications
    where seller_account_id = seller_record.id
      and state = 'verified'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Verified seller status is required.';
  end if;

  select *
  into settlement_record
  from public.settlement_profiles
  where seller_account_id = seller_record.id
    and provider = 'paystack';

  if settlement_record.id is null then
    raise exception using
      errcode = '55000',
      message = 'Safe settlement profile is required.';
  end if;

  if p_metadata ->> 'bankCode' is distinct from settlement_record.bank_code
    or p_metadata ->> 'bankName' is distinct from settlement_record.bank_name
    or p_metadata ->> 'accountLast4' is distinct from settlement_record.account_last4
    or p_metadata ->> 'country' is distinct from seller_record.country::text
  then
    raise exception using
      errcode = '22023',
      message = 'Payment metadata does not match persisted seller facts.';
  end if;

  if not exists (
    select 1
    from public.shops
    where seller_account_id = seller_record.id
      and status = 'draft'
      and btrim(display_name) <> ''
      and btrim(coalesce(legal_name, '')) <> ''
  ) then
    raise exception using
      errcode = '55000',
      message = 'Draft shop identity is required.';
  end if;

  insert into public.payment_subaccounts (
    seller_account_id,
    provider,
    status,
    request_fingerprint,
    metadata
  )
  values (
    p_seller_account_id,
    'paystack',
    'pending',
    p_request_fingerprint,
    p_metadata
  )
  on conflict (seller_account_id, provider) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return query
      select
        'reserved'::text,
        inserted_id,
        null::text,
        null::text,
        null::jsonb;
    return;
  end if;

  select *
  into existing_record
  from public.payment_subaccounts
  where seller_account_id = p_seller_account_id
    and provider = 'paystack';

  return query
    select
      case
        when existing_record.status = 'active' then 'active'
        when existing_record.provider_subaccount_id is not null
          and existing_record.provider_subaccount_code is not null
          then 'provider_created'
        else 'in_progress'
      end,
      existing_record.id,
      existing_record.provider_subaccount_id,
      existing_record.provider_subaccount_code,
      case
        when existing_record.provider_subaccount_id is not null
          and existing_record.provider_subaccount_code is not null
          then existing_record.metadata
        else null
      end;
end;
$$;

create function public.record_payment_subaccount_provider_result(
  p_auth_user_id uuid,
  p_seller_account_id uuid,
  p_reservation_id uuid,
  p_provider_id text,
  p_subaccount_code text,
  p_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  seller_record public.seller_accounts%rowtype;
  reservation_record public.payment_subaccounts%rowtype;
  settlement_record public.settlement_profiles%rowtype;
begin
  select *
  into seller_record
  from public.seller_accounts
  where id = p_seller_account_id;

  if seller_record.id is null
    or seller_record.auth_user_id <> p_auth_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'Payment seller ownership mismatch.';
  end if;

  if seller_record.status not in ('pending', 'active') then
    raise exception using
      errcode = '55000',
      message = 'Seller account is not eligible for payment setup.';
  end if;

  select *
  into settlement_record
  from public.settlement_profiles
  where seller_account_id = seller_record.id
    and provider = 'paystack';

  if btrim(coalesce(p_provider_id, '')) = ''
    or btrim(coalesce(p_subaccount_code, '')) = ''
    or jsonb_typeof(p_metadata) <> 'object'
    or public.jsonb_has_sensitive_account_key(p_metadata)
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid payment provider result.';
  end if;

  select *
  into reservation_record
  from public.payment_subaccounts
  where id = p_reservation_id
    and seller_account_id = p_seller_account_id
    and provider = 'paystack'
  for update;

  if reservation_record.id is null
    or reservation_record.status <> 'pending'
  then
    raise exception using
      errcode = '55000',
      message = 'Payment reservation is not available for provider result recording.';
  end if;

  if settlement_record.id is null
    or p_metadata is distinct from reservation_record.metadata
    or p_metadata ->> 'bankCode' is distinct from settlement_record.bank_code
    or p_metadata ->> 'bankName' is distinct from settlement_record.bank_name
    or p_metadata ->> 'accountLast4' is distinct from settlement_record.account_last4
    or p_metadata ->> 'country' is distinct from seller_record.country::text
  then
    raise exception using
      errcode = '22023',
      message = 'Payment metadata does not match persisted seller facts.';
  end if;

  if reservation_record.provider_subaccount_id is not null
    or reservation_record.provider_subaccount_code is not null
  then
    if reservation_record.provider_subaccount_id = p_provider_id
      and reservation_record.provider_subaccount_code = p_subaccount_code
    then
      return true;
    end if;

    raise exception using
      errcode = '55000',
      message = 'A different provider result is already recorded.';
  end if;

  update public.payment_subaccounts
  set
    provider_subaccount_id = p_provider_id,
    provider_subaccount_code = p_subaccount_code,
    metadata = p_metadata
  where id = p_reservation_id
    and seller_account_id = p_seller_account_id
    and provider = 'paystack'
    and status = 'pending';

  return true;
end;
$$;

create function public.activate_payment_subaccount_request(
  p_auth_user_id uuid,
  p_seller_account_id uuid,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  seller_record public.seller_accounts%rowtype;
  reservation_record public.payment_subaccounts%rowtype;
  settlement_record public.settlement_profiles%rowtype;
begin
  select *
  into seller_record
  from public.seller_accounts
  where id = p_seller_account_id;

  if seller_record.id is null
    or seller_record.auth_user_id <> p_auth_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'Payment seller ownership mismatch.';
  end if;

  if seller_record.status not in ('pending', 'active') then
    raise exception using
      errcode = '55000',
      message = 'Seller account is not eligible for payment setup.';
  end if;

  if not exists (
    select 1
    from public.policy_acceptances
    where seller_account_id = seller_record.id
      and policy_key = 'seller_terms'
      and policy_version = '2026-06-12'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Current seller policy acceptance is required.';
  end if;

  if not exists (
    select 1
    from public.seller_verifications
    where seller_account_id = seller_record.id
      and state = 'verified'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Verified seller status is required.';
  end if;

  if not exists (
    select 1
    from public.shops
    where seller_account_id = seller_record.id
      and status = 'draft'
      and btrim(display_name) <> ''
      and btrim(coalesce(legal_name, '')) <> ''
  ) then
    raise exception using
      errcode = '55000',
      message = 'Draft shop identity is required.';
  end if;

  select *
  into settlement_record
  from public.settlement_profiles
  where seller_account_id = seller_record.id
    and provider = 'paystack'
  for update;

  if settlement_record.id is null then
    raise exception using
      errcode = '55000',
      message = 'Safe settlement profile is required.';
  end if;

  select *
  into reservation_record
  from public.payment_subaccounts
  where id = p_reservation_id
    and seller_account_id = p_seller_account_id
    and provider = 'paystack'
  for update;

  if reservation_record.id is null
    or reservation_record.status not in ('pending', 'active')
  then
    raise exception using
      errcode = '55000',
      message = 'Payment reservation is not available for activation.';
  end if;

  if reservation_record.provider_subaccount_id is null
    or reservation_record.provider_subaccount_code is null
  then
    raise exception using
      errcode = '55000',
      message = 'Provider creation result has not been recorded.';
  end if;

  if public.jsonb_has_sensitive_account_key(reservation_record.metadata)
    or reservation_record.metadata ->> 'bankCode' is distinct from settlement_record.bank_code
    or reservation_record.metadata ->> 'bankName' is distinct from settlement_record.bank_name
    or reservation_record.metadata ->> 'accountLast4' is distinct from settlement_record.account_last4
    or reservation_record.metadata ->> 'country' is distinct from seller_record.country::text
  then
    raise exception using
      errcode = '22023',
      message = 'Persisted provider result does not match locked settlement facts.';
  end if;

  if reservation_record.status = 'active' then
    return true;
  end if;

  update public.payment_subaccounts
  set status = 'active'
  where id = reservation_record.id
    and status = 'pending';

  update public.settlement_profiles
  set status = 'active'
  where id = settlement_record.id;

  return true;
end;
$$;

alter table public.policy_acceptances enable row level security;
alter table public.policy_acceptances force row level security;
alter table public.settlement_profiles enable row level security;
alter table public.settlement_profiles force row level security;

create policy policy_acceptances_owner_operator_read
on public.policy_acceptances
for select
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy policy_acceptances_owner_insert
on public.policy_acceptances
for insert
to authenticated
with check (
  seller_account_id = (select public.current_seller_account_id())
  and accepted_by_user_id = auth.uid()
  and (select public.current_seller_status()) in ('pending', 'active')
);

create policy settlement_profiles_owner_operator_read
on public.settlement_profiles
for select
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy settlement_profiles_owner_insert
on public.settlement_profiles
for insert
to authenticated
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and provider = 'paystack'
  and status = 'pending'
  and metadata = '{}'::jsonb
);

create policy settlement_profiles_owner_update
on public.settlement_profiles
for update
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and status = 'pending'
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and provider = 'paystack'
  and status = 'pending'
  and metadata = '{}'::jsonb
);

revoke all on
  public.policy_acceptances,
  public.settlement_profiles
from public, anon, authenticated;

revoke execute on function public.jsonb_has_sensitive_account_key(jsonb)
from public, anon;
revoke execute on function public.save_onboarding_shop(text, text, text, text)
from public, anon;
revoke execute on function public.bootstrap_seller_account(uuid, public.country_code, text, text)
from public, anon, authenticated;
revoke execute on function public.reserve_payment_subaccount_request(uuid, uuid, text, jsonb)
from public, anon, authenticated;
revoke execute on function public.record_payment_subaccount_provider_result(uuid, uuid, uuid, text, text, jsonb)
from public, anon, authenticated;
revoke execute on function public.activate_payment_subaccount_request(uuid, uuid, uuid)
from public, anon, authenticated;

grant select on
  public.policy_acceptances,
  public.settlement_profiles
to authenticated;

grant insert (
  seller_account_id,
  policy_key,
  policy_version
) on public.policy_acceptances to authenticated;

grant insert (
  seller_account_id,
  provider,
  bank_code,
  bank_name,
  account_last4
) on public.settlement_profiles to authenticated;

grant update (
  bank_code,
  bank_name,
  account_last4
) on public.settlement_profiles to authenticated;

grant execute on function public.save_onboarding_shop(text, text, text, text)
to authenticated;

grant execute on function public.jsonb_has_sensitive_account_key(jsonb)
to authenticated, service_role;

grant all on
  public.policy_acceptances,
  public.settlement_profiles
to service_role;

grant execute on function public.reserve_payment_subaccount_request(uuid, uuid, text, jsonb)
to service_role;

grant execute on function public.record_payment_subaccount_provider_result(uuid, uuid, uuid, text, text, jsonb)
to service_role;

grant execute on function public.activate_payment_subaccount_request(uuid, uuid, uuid)
to service_role;

grant execute on function public.bootstrap_seller_account(uuid, public.country_code, text, text)
to service_role;
