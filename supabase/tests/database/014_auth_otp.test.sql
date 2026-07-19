begin;

set local search_path = extensions, public;

select plan(5);

select col_is_null(
  'public', 'seller_accounts', 'contact_email',
  'seller_accounts.contact_email is nullable'
);

-- Phone-only confirmed user: bootstrap succeeds with contact_email null.
insert into auth.users (
  id, instance_id, aud, role, email, phone, encrypted_password,
  email_confirmed_at, phone_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000008101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', null, '+233241234599', '',
  null, now(), '{}'::jsonb, now(), now()
);

select lives_ok(
  $$
    select public.bootstrap_seller_account(
      '00000000-0000-0000-0000-000000008101',
      'GH', 'Phone Only Seller', '+233241234599'
    )
  $$,
  'bootstrap_seller_account succeeds for a phone-verified, email-less user'
);

select is(
  (select contact_email from public.seller_accounts where auth_user_id = '00000000-0000-0000-0000-000000008101'),
  null,
  'the resulting seller_accounts row has a null contact_email'
);

-- Neither email nor phone verified: bootstrap still raises.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000008102',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'unverified@example.com', '',
  null, '{}'::jsonb, now(), now()
);

select throws_ok(
  $$
    select public.bootstrap_seller_account(
      '00000000-0000-0000-0000-000000008102',
      'GH', 'Unverified Seller', '+233241234598'
    )
  $$,
  '42501',
  null,
  'bootstrap_seller_account raises when neither email nor phone is verified'
);

-- An unconfirmed email on a phone-verified user must NOT be treated as
-- verified — contact_email must stay null, not leak the unconfirmed address.
insert into auth.users (
  id, instance_id, aud, role, email, phone, encrypted_password,
  email_confirmed_at, phone_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000008103',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'unconfirmed-email@example.com', '+233241234597', '',
  null, now(), '{}'::jsonb, now(), now()
);
select public.bootstrap_seller_account(
  '00000000-0000-0000-0000-000000008103',
  'GH', 'Mixed Verification Seller', '+233241234597'
);
select is(
  (select contact_email from public.seller_accounts where auth_user_id = '00000000-0000-0000-0000-000000008103'),
  null,
  'an unconfirmed email is never used as contact_email, even when phone is verified'
);

select * from finish();
rollback;
