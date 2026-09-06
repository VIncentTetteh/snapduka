-- A creator can mint their own tracked links, and only their own.
--
-- Before 202609060096 the only path that could create a creator link was the
-- seller's dashboard, so an influencer who accepted an invitation landed on a
-- page telling them to go and ask the shop. This is new write access for a role
-- that is not a seller, so both directions are asserted: what a creator may now
-- do, and the four things they still may not.
--
-- Most of the narrowing predates this policy — the composite key
-- campaign_links_shop_same_seller and the campaign_links_guard_destination
-- trigger already make a cross-tenant or off-shop link impossible — so the
-- refusals below deliberately include cases where those bite instead of RLS.

begin;

set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
 ('0cc00000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','seller@links.test',now(),now()),
 ('0cc00000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','creator@links.test',now(),now()),
 ('0cc00000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@links.test',now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name) values
 ('0cc00000-0000-4000-8000-000000000010','0cc00000-0000-4000-8000-000000000001','GH','active',true,'Partner Shop Owner'),
 ('0cc00000-0000-4000-8000-000000000011','0cc00000-0000-4000-8000-000000000003','GH','active',true,'Stranger Shop Owner');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at) values
 ('0cc00000-0000-4000-8000-000000000020','0cc00000-0000-4000-8000-000000000010','partner-shop','Partner Shop','GH','GHS','published',now()),
 ('0cc00000-0000-4000-8000-000000000021','0cc00000-0000-4000-8000-000000000011','stranger-shop','Stranger Shop','GH','GHS','published',now());

insert into public.creators (id, auth_user_id, handle, display_name, country, status, contact_phone)
values ('0cc00000-0000-4000-8000-000000000030','0cc00000-0000-4000-8000-000000000002','link_tester','Link Tester','GH','active','+233201234599');

insert into public.creator_partnerships (id, seller_account_id, creator_id, status, rate_bps, hold_days, currency, accepted_at)
values ('0cc00000-0000-4000-8000-000000000040','0cc00000-0000-4000-8000-000000000010',
        '0cc00000-0000-4000-8000-000000000030','active',1000,14,'GHS',now());

-- ── What a creator may now do ──────────────────────────────────────────────
-- A product path, which is the case that did not exist at all before: every
-- creator link used to point at the shop homepage.
select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0cc00000-0000-4000-8000-000000000002","role":"authenticated"}';
     insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
     values ('0cc00000-0000-4000-8000-000000000010','0cc00000-0000-4000-8000-000000000020',
             'Tester · whatsapp','crtest-w','whatsapp','/partner-shop/products/abc',
             '0cc00000-0000-4000-8000-000000000040') $$,
  'a creator can mint a link to a product in a shop they partner with'
);

select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0cc00000-0000-4000-8000-000000000002","role":"authenticated"}';
     insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
     values ('0cc00000-0000-4000-8000-000000000010','0cc00000-0000-4000-8000-000000000020',
             'Tester · storefront','crtest-s','instagram','/partner-shop',
             '0cc00000-0000-4000-8000-000000000040') $$,
  'and to the storefront itself'
);

-- ── And nothing beyond that ────────────────────────────────────────────────
-- A shop they have no partnership with, using a path that is valid for THAT
-- shop, so the destination trigger is satisfied and only the policy can refuse.
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0cc00000-0000-4000-8000-000000000002","role":"authenticated"}';
     insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
     values ('0cc00000-0000-4000-8000-000000000011','0cc00000-0000-4000-8000-000000000021',
             'not mine','crtest-x','whatsapp','/stranger-shop',
             '0cc00000-0000-4000-8000-000000000040') $$,
  '42501',
  NULL,
  'a creator cannot mint a link for a shop they do not partner with'
);

-- Without a partnership id this is an ordinary seller link, and a creator is
-- not a seller.
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0cc00000-0000-4000-8000-000000000002","role":"authenticated"}';
     insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path)
     values ('0cc00000-0000-4000-8000-000000000010','0cc00000-0000-4000-8000-000000000020',
             'plain seller link','crtest-p','whatsapp','/partner-shop') $$,
  '42501',
  NULL,
  'a creator cannot mint an ordinary seller link'
);

-- Pausing a partnership is the seller's lever. It has to stop the creator
-- making new links, not merely stop accrual afterwards.
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0cc00000-0000-4000-8000-000000000002","role":"authenticated"}';
     update public.creator_partnerships set status = 'paused' where id = '0cc00000-0000-4000-8000-000000000040';
     insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
     values ('0cc00000-0000-4000-8000-000000000010','0cc00000-0000-4000-8000-000000000020',
             'while paused','crtest-z','whatsapp','/partner-shop',
             '0cc00000-0000-4000-8000-000000000040') $$,
  '42501',
  NULL,
  'a creator cannot mint a link while the partnership is paused'
);

-- The destination trigger still applies to creators.
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0cc00000-0000-4000-8000-000000000002","role":"authenticated"}';
     insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path, creator_partnership_id)
     values ('0cc00000-0000-4000-8000-000000000010','0cc00000-0000-4000-8000-000000000020',
             'off shop','crtest-d','whatsapp','/dashboard/settings/billing',
             '0cc00000-0000-4000-8000-000000000040') $$,
  '23514',
  NULL,
  'a creator cannot aim a link outside the shop they are promoting'
);

-- seller_account_operable gained a creator branch in the same migration. It
-- must still refuse to answer about an account the caller has no part in —
-- that is what stops it being used to probe whether a shop is suspended.
select ok(
  not (
    select public.seller_account_operable('0cc00000-0000-4000-8000-000000000011')
    from (select set_config('role','authenticated',true),
                 set_config('request.jwt.claims','{"sub":"0cc00000-0000-4000-8000-000000000002","role":"authenticated"}',true)) _
  ),
  'a creator still cannot probe the status of a shop they do not partner with'
);

select * from finish();
rollback;
