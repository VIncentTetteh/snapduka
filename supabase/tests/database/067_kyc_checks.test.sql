-- Automated KYC (202609250143): how a vendor result may, and may not, move a
-- seller's verification state — and that raw identity data cannot be stored.

begin;

set local search_path = extensions, public;

select plan(20);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('67670000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'kyc' || n || '@test', now(), now()
from generate_series(1, 4) as n;

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
select ('67670000-0000-4000-8000-0000000000a' || n)::uuid,
       ('67670000-0000-4000-8000-00000000000' || n)::uuid, 'GH', 'active', true, 'KYC Seller ' || n
from generate_series(1, 4) as n;

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('67670000-0000-4000-8000-0000000000b1', '67670000-0000-4000-8000-0000000000a1',
        'kyc-shop-1', 'KYC Shop', 'GH', 'GHS', 'published', now());

-- ── starting ────────────────────────────────────────────────────────────────
select lives_ok($$select public.start_kyc_check('67670000-0000-4000-8000-0000000000a1',
  'sandbox', 'ghana_card', 'ref-1', now() + interval '1 year')$$, 'a check can be started');
select is((select state::text from public.seller_verifications
            where seller_account_id = '67670000-0000-4000-8000-0000000000a1'),
  'in_progress', 'starting a check puts the seller in progress');
select throws_ok($$select public.start_kyc_check('67670000-0000-4000-8000-0000000000a1',
  'sandbox', 'ghana_card', 'ref-1')$$, '23505', null, 'a vendor reference identifies one check');
select throws_ok($$select public.start_kyc_check('67670000-0000-4000-8000-0000000000a1',
  'sandbox', 'passport', 'ref-x')$$, '23514', null, 'only known check types');

-- ── a pass verifies ─────────────────────────────────────────────────────────
select is(
  (public.apply_kyc_result('sandbox', 'ref-1', 'passed', 97.5, 'GHA-*******12-3', null, '{"vendorJobId":"j1"}'::jsonb)) ->> 'verificationState',
  'verified', 'a passing Ghana Card check verifies the seller');
select is((select provider_reference from public.seller_verifications
            where seller_account_id = '67670000-0000-4000-8000-0000000000a1'),
  'ref-1', 'with the vendor reference recorded');
select isnt((select verified_at from public.shops where id = '67670000-0000-4000-8000-0000000000b1'),
  null, 'and the storefront badge follows');
select is(
  (public.apply_kyc_result('sandbox', 'ref-1', 'failed')) ->> 'applied',
  'false', 'a terminal result is final: a late contradicting webhook changes nothing');
select is((select count(*)::int from public.domain_events
            where event_type = 'kyc.result' and aggregate_id = '67670000-0000-4000-8000-0000000000a1'),
  1, 'the result is emitted once for the risk engine');

-- ── a failure asks for action, never demotes ────────────────────────────────
select public.start_kyc_check('67670000-0000-4000-8000-0000000000a2', 'sandbox', 'ghana_card', 'ref-2');
select is(
  (public.apply_kyc_result('sandbox', 'ref-2', 'failed', 12, null, 'Photo did not match')) ->> 'verificationState',
  'needs_action', 'a failed check asks the seller to try again');

select public.start_kyc_check('67670000-0000-4000-8000-0000000000a1', 'sandbox', 'ghana_card', 'ref-1b');
select is((select state::text from public.seller_verifications
            where seller_account_id = '67670000-0000-4000-8000-0000000000a1'),
  'verified', 'starting a new check does not un-verify a verified seller');
select public.apply_kyc_result('sandbox', 'ref-1b', 'failed');
select is((select state::text from public.seller_verifications
            where seller_account_id = '67670000-0000-4000-8000-0000000000a1'),
  'verified', 'a failed re-check never demotes a verified seller');

-- ── the operator always wins ────────────────────────────────────────────────
insert into public.seller_verifications (seller_account_id, state, provider, provider_reference, checked_at)
values ('67670000-0000-4000-8000-0000000000a3', 'rejected', 'operator', 'op-1', now());
select public.start_kyc_check('67670000-0000-4000-8000-0000000000a3', 'sandbox', 'ghana_card', 'ref-3');
select is((select state::text from public.seller_verifications
            where seller_account_id = '67670000-0000-4000-8000-0000000000a3'),
  'rejected', 'starting a check does not lift an operator rejection');
select public.apply_kyc_result('sandbox', 'ref-3', 'passed', 99);
select is((select state::text from public.seller_verifications
            where seller_account_id = '67670000-0000-4000-8000-0000000000a3'),
  'rejected', 'an automated pass never overturns an operator rejection');

-- ── liveness alone is not identity ──────────────────────────────────────────
select public.start_kyc_check('67670000-0000-4000-8000-0000000000a4', 'sandbox', 'liveness', 'ref-4');
select public.apply_kyc_result('sandbox', 'ref-4', 'passed', 99);
select is((select state::text from public.seller_verifications
            where seller_account_id = '67670000-0000-4000-8000-0000000000a4'),
  'in_progress', 'a liveness pass alone does not verify');

select is((public.apply_kyc_result('sandbox', 'nope', 'passed')) ->> 'reason', 'unknown_check',
  'a result for a check we never started is ignored');

-- ── Act 843: no raw identity data ───────────────────────────────────────────
select public.start_kyc_check('67670000-0000-4000-8000-0000000000a4', 'sandbox', 'ghana_card', 'ref-5');
select throws_ok($$select public.apply_kyc_result('sandbox', 'ref-5', 'passed', 90, 'GHA-*1', null,
  '{"idNumber":"GHA-123456789-0"}'::jsonb)$$, '23514', null, 'a raw ID number cannot be stored');
select throws_ok($$select public.apply_kyc_result('sandbox', 'ref-5', 'passed', 90, 'GHA-123456789-0')$$,
  '23514', null, 'an unmasked id cannot be stored as the masked id');

-- ── access ──────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated',
  'public.apply_kyc_result(text,text,text,numeric,text,text,jsonb)', 'execute'),
  'no client can apply a KYC result');
select ok(not has_table_privilege('authenticated', 'public.kyc_checks', 'insert'),
  'no client can insert a check');

select * from finish();
rollback;
