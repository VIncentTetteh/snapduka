-- Payment subaccount setup originally required the shop to still be a
-- draft (publish-last flow). The onboarding wizard allows publishing first
-- and connecting payments later, so accept published shops too.

CREATE OR REPLACE FUNCTION public.reserve_payment_subaccount_request(p_auth_user_id uuid, p_seller_account_id uuid, p_request_fingerprint text, p_metadata jsonb)
 RETURNS TABLE(reservation_status text, reservation_id uuid, provider_subaccount_id text, provider_subaccount_code text, provider_metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
      and status in ('draft', 'published')
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
$function$;

CREATE OR REPLACE FUNCTION public.activate_payment_subaccount_request(p_auth_user_id uuid, p_seller_account_id uuid, p_reservation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
      and status in ('draft', 'published')
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
$function$;
