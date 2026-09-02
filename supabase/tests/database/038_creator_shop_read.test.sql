-- shops_creator_partner_read exists for one narrow case: a shop a creator
-- partners with that is NOT published. Published shops are already readable by
-- anyone through shops_public_read, so a test that only covers a published shop
-- would pass with the policy deleted and prove nothing.
--
-- The second property matters just as much: the policy must not widen access to
-- shops the creator has no partnership with.

begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('a4a40000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'partner@creator.test', now(), now()),
  ('a4a40000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner@shop.test', now(), now()),
  ('a4a40000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'stranger@shop.test', now(), now());

insert into public.creators (id, auth_user_id, handle, display_name, contact_phone, country, status)
values ('b4b40000-0000-4000-8000-000000000001', 'a4a40000-0000-4000-8000-000000000001',
        'partner_creator', 'Partner Creator', '+233241234567', 'GH', 'active');

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values
  ('c4c40000-0000-4000-8000-000000000001', 'a4a40000-0000-4000-8000-000000000002',
   'GH', 'active', true, 'Partner Shop Owner'),
  ('c4c40000-0000-4000-8000-000000000002', 'a4a40000-0000-4000-8000-000000000003',
   'GH', 'active', true, 'Stranger Shop Owner');

-- Both shops are deliberately left unpublished, so shops_public_read cannot
-- account for either result.
insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status)
values
  ('d4d40000-0000-4000-8000-000000000001', 'c4c40000-0000-4000-8000-000000000001',
   'partner-shop', 'Partner Shop', 'GH', 'GHS', 'draft'),
  ('d4d40000-0000-4000-8000-000000000002', 'c4c40000-0000-4000-8000-000000000002',
   'stranger-shop', 'Stranger Shop', 'GH', 'GHS', 'draft');

-- creator_partnerships_accepted_check: an active or paused partnership must
-- carry accepted_at.
insert into public.creator_partnerships (seller_account_id, creator_id, status, rate_bps, hold_days, currency, accepted_at)
values ('c4c40000-0000-4000-8000-000000000001', 'b4b40000-0000-4000-8000-000000000001',
        'active', 1000, 14, 'GHS', now());

select is(
  (select count(*) from pg_policy
   where polrelid = 'public.shops'::regclass and polname = 'shops_creator_partner_read'),
  1::bigint,
  'the policy exists'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a4a40000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select display_name from public.shops where id = 'd4d40000-0000-4000-8000-000000000001'),
  'Partner Shop',
  'a creator reads a partner shop even though it is not published'
);

select is(
  (select count(*) from public.shops where id = 'd4d40000-0000-4000-8000-000000000002'),
  0::bigint,
  'a creator cannot read an unpublished shop they do not partner with'
);

reset role;

-- A signed-in user with no creator profile at all must gain nothing: the policy
-- keys off current_creator_id(), which is null for them.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4a40000-0000-4000-8000-000000000003","role":"authenticated"}';

select is(
  (select count(*) from public.shops where id = 'd4d40000-0000-4000-8000-000000000001'),
  0::bigint,
  'a non-creator gains no access through this policy'
);

select * from finish();

rollback;
