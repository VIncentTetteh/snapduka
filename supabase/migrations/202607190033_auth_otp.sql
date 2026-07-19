-- supabase/migrations/202607190033_auth_otp.sql
-- Unified email/phone OTP login: contact_email becomes optional so a
-- phone-only seller can complete onboarding without ever supplying an
-- email. bootstrap_seller_account now accepts either a verified email or
-- a verified phone from auth.users (it previously required a verified
-- email unconditionally). contact_phone stays mandatory regardless of
-- login channel — it is always collected via the onboarding form.

alter table public.seller_accounts
  alter column contact_email drop not null;

alter table public.seller_accounts
  drop constraint seller_accounts_contact_email_check;

alter table public.seller_accounts
  add constraint seller_accounts_contact_email_check
  check (
    contact_email is null
    or (
      contact_email = lower(contact_email)
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create or replace function public.bootstrap_seller_account(
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
  is_phone_verified boolean;
  seller_id uuid;
begin
  select
    case when email_confirmed_at is not null then lower(email) else null end,
    phone_confirmed_at is not null
  into verified_email, is_phone_verified
  from auth.users
  where id = p_auth_user_id
    and (email_confirmed_at is not null or phone_confirmed_at is not null);

  if verified_email is null and not coalesce(is_phone_verified, false) then
    raise exception using
      errcode = '42501',
      message = 'A verified email or phone number is required.';
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
