-- The storefront badge is only as honest as this trigger.
--
-- store-header.tsx rendered "Verified seller" unconditionally; 4 of the 5 live
-- shops were showing it while their state was 'not_started'. The storefront
-- reads shops.verified_at with the anon key because seller_verifications is
-- owner/operator-only, so if this mirror drifts the badge lies again.

begin;

set local search_path = extensions, public;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('a1b20000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'verify@shop.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('a1b20000-0000-4000-8000-000000000002', 'a1b20000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Verify Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('a1b20000-0000-4000-8000-000000000003', 'a1b20000-0000-4000-8000-000000000002',
        'verify-shop', 'Verify Shop', 'GH', 'GHS', 'published', now());

select has_column('public', 'shops', 'verified_at',
  'shops carry the public mirror of verification state');

-- ---------------------------------------------------------------------------
-- A shop with no verification row must not be marked verified. This is the
-- exact production state of 4 of the 5 live shops.
-- ---------------------------------------------------------------------------
select is(
  (select verified_at from public.shops where id = 'a1b20000-0000-4000-8000-000000000003'),
  null,
  'a shop with no verification row is not verified');

insert into public.seller_verifications (seller_account_id, state)
values ('a1b20000-0000-4000-8000-000000000002', 'not_started');

select is(
  (select verified_at from public.shops where id = 'a1b20000-0000-4000-8000-000000000003'),
  null,
  'not_started does not set the badge');

-- ---------------------------------------------------------------------------
-- Only 'verified' earns it.
-- ---------------------------------------------------------------------------
update public.seller_verifications
   set state = 'in_progress'
 where seller_account_id = 'a1b20000-0000-4000-8000-000000000002';

select is(
  (select verified_at from public.shops where id = 'a1b20000-0000-4000-8000-000000000003'),
  null,
  'a review in progress does not set the badge');

update public.seller_verifications
   set state = 'verified', provider = 'operator',
       provider_reference = 'op-test', checked_at = now()
 where seller_account_id = 'a1b20000-0000-4000-8000-000000000002';

select isnt(
  (select verified_at from public.shops where id = 'a1b20000-0000-4000-8000-000000000003'),
  null,
  'verifying a seller sets the badge on their shop');

-- ---------------------------------------------------------------------------
-- Losing verification must remove it. A suspended seller keeping a green check
-- is the same lie with worse consequences.
-- ---------------------------------------------------------------------------
update public.seller_verifications
   set state = 'suspended'
 where seller_account_id = 'a1b20000-0000-4000-8000-000000000002';

select is(
  (select verified_at from public.shops where id = 'a1b20000-0000-4000-8000-000000000003'),
  null,
  'suspending a seller removes the badge');

update public.seller_verifications
   set state = 'rejected'
 where seller_account_id = 'a1b20000-0000-4000-8000-000000000002';

select is(
  (select verified_at from public.shops where id = 'a1b20000-0000-4000-8000-000000000003'),
  null,
  'a rejected seller has no badge');

-- ---------------------------------------------------------------------------
-- The mirror is not writable by the people it describes: a seller must not be
-- able to award themselves the badge by updating their own shop row.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'shops'
      and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE')),
  0,
  'anon cannot write shops');

select ok(
  not has_function_privilege('anon', 'public.sync_shop_verified_at()', 'execute'),
  'the sync function is not callable by anon');

select * from finish();
rollback;
