-- supabase/migrations/202607190034_contact_phone_country_check.sql
-- The old contact_phone check (8-15 digit E.164 range) accepted a Ghana
-- number with the wrong local-digit count as long as it fell in that
-- shared range. Replace it with an exact per-country check matching the
-- app-layer validator in src/lib/countries/phone.ts: GH 9 local digits,
-- NG 10, CI 10.

alter table public.seller_accounts
  drop constraint seller_accounts_contact_phone_check;

alter table public.seller_accounts
  add constraint seller_accounts_contact_phone_check
  check (
    contact_phone is null
    or (country = 'GH' and contact_phone ~ '^\+233[0-9]{9}$')
    or (country = 'NG' and contact_phone ~ '^\+234[0-9]{10}$')
    or (country = 'CI' and contact_phone ~ '^\+225[0-9]{10}$')
  );
