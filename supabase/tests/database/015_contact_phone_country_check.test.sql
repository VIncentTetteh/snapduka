-- supabase/tests/database/015_contact_phone_country_check.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000009101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'phone-check@example.com', '',
  now(), '{}'::jsonb, now(), now()
);

select lives_ok(
  $$
    insert into public.seller_accounts (
      id, auth_user_id, country, status, is_active,
      contact_name, contact_email, contact_phone
    ) values (
      '00000000-0000-0000-0000-000000009201',
      '00000000-0000-0000-0000-000000009101',
      'GH', 'active', true, 'GH Seller', 'phone-check@example.com', '+233241234567'
    )
  $$,
  'a correctly-sized 9-digit Ghana number is accepted'
);

select throws_ok(
  $$
    update public.seller_accounts
    set contact_phone = '+23324123456'
    where id = '00000000-0000-0000-0000-000000009201'
  $$,
  '23514',
  null,
  'an 8-digit Ghana number is rejected'
);

select throws_ok(
  $$
    update public.seller_accounts
    set contact_phone = '+234241234567'
    where id = '00000000-0000-0000-0000-000000009201'
  $$,
  '23514',
  null,
  'a GH-country row with a NG-shaped calling code is rejected'
);

select is(
  (select contact_phone from public.seller_accounts where id = '00000000-0000-0000-0000-000000009201'),
  '+233241234567',
  'the row still has its original valid value after the rejected updates'
);

select * from finish();
rollback;
