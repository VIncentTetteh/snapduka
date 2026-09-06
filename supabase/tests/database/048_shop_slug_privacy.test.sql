-- supabase/tests/database/048_shop_slug_privacy.test.sql
--
-- The storefront address must not be somewhere a seller can put their home.
--
-- It was a free-text field in onboarding, defaulted from the shop name but
-- freely overridable and never editable afterwards. One live shop read
-- `/suma-ampim-st-23` while its display name was "PurePlatter Foods" — the
-- seller typed where they live, and it went into the link they share on
-- Instagram, into every tracked link, into the QR code, and into the unfurl on
-- every WhatsApp forward. Nothing in the flow said the field was public or
-- permanent.
--
-- The address is derived now: the shop's own name, which is already its public
-- identity, plus a short random code. `save_onboarding_shop` no longer takes a
-- slug at all, so there is no longer a parameter for a caller to fill with
-- anything else.
begin;

set local search_path = extensions, public;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
 ('1dd00000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','slug1@test.test',now(),now()),
 ('1dd00000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','slug2@test.test',now(),now());

-- is_active must mirror status; `pending` is what a seller is mid-onboarding,
-- which is the only state this RPC accepts a shop edit in.
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name) values
 ('2dd00000-0000-4000-8000-000000000001','1dd00000-0000-4000-8000-000000000001','GH','pending',false,'Slug Tester'),
 ('2dd00000-0000-4000-8000-000000000002','1dd00000-0000-4000-8000-000000000002','GH','pending',false,'Twin Tester');

create temp table seen(what text, value text);

set local role authenticated;
set local request.jwt.claims = '{"sub":"1dd00000-0000-4000-8000-000000000001","role":"authenticated"}';

select public.save_onboarding_shop('PurePlatter Foods', 'PurePlatter Foods Ltd', '');
insert into seen select 'first-slug', slug from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000001';
insert into seen select 'first-code', slug_code from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000001';

select ok(
  (select value from seen where what='first-slug') ~ '^pureplatter-foods-[23456789abcdefghjkmnpqrstvwxyz]{4}$',
  'the address is derived from the shop name plus a short code');

-- The code is not decoration: without it the first shop to claim a common name
-- takes it globally, and everyone after gets "that address is already taken".
select ok(
  (select value from seen where what='first-slug') <> 'pureplatter-foods',
  'and never the bare name, so two shops with one name cannot race for it');

-- save_onboarding_shop rewrites the row on every draft save, so a code derived
-- fresh each time would hand the seller a different URL every time they fixed a
-- typo. That is why the code has its own column.
select public.save_onboarding_shop('PurePlatter Foods Accra', 'PurePlatter Foods Ltd', '');

select is(
  (select slug_code from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000001'),
  (select value from seen where what='first-code'),
  'correcting the shop name keeps the same code, so the URL does not churn mid-onboarding');
select ok(
  (select slug from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000001')
    like 'pureplatter-foods-accra-%',
  'while the readable half follows the new name');

-- ── A second shop with an identical name ───────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"1dd00000-0000-4000-8000-000000000002","role":"authenticated"}';

select public.save_onboarding_shop('PurePlatter Foods Accra', 'Another Ltd', '');

select ok(
  (select slug from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000002')
    like 'pureplatter-foods-accra-%',
  'a second shop with the very same name still gets an address');
select isnt(
  (select slug from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000002'),
  (select slug from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000001'),
  'and it is a different one');

-- ── A name that slugifies to nothing ───────────────────────────────────────
-- The display-name check only requires two characters, and "!!" clears it.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"1dd00000-0000-4000-8000-000000000001","role":"authenticated"}';

select public.save_onboarding_shop('!!', 'Legal Ltd', '');

select ok(
  (select slug from public.shops where seller_account_id='2dd00000-0000-4000-8000-000000000001') like 'shop-%',
  'a name that is all punctuation still yields a valid address rather than a broken one');

reset role;

-- The point of the whole change, asserted directly.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_onboarding_shop'
      and pg_get_function_identity_arguments(p.oid) = 'text, text, text, text'),
  0,
  'the slug is no longer a parameter a caller can supply');

select * from finish();
rollback;
