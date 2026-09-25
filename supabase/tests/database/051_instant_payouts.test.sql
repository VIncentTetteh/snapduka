-- Instant withdrawals are paid and gated; standard ones wait for their batch.

begin;

set local search_path = extensions, public;

select plan(10);

update public.country_configs
   set payouts_enabled = true, payout_fee_minor = 100, minimum_payout_minor = 1000,
       payout_auto_approve_max_minor = 1000000,
       instant_payout_fee_bps = 100, instant_payout_fee_min_minor = 150
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('51510000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'instant@example.com', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email)
values ('51510000-0000-4000-8000-0000000000a1', '51510000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Instant Seller', 'instant@example.com');
insert into public.payout_destinations (
  seller_account_id, currency, type, bank_code, bank_name, account_last4,
  recipient_code, status, activated_at, request_fingerprint)
values ('51510000-0000-4000-8000-0000000000a1', 'GHS', 'mobile_money', 'MTN', 'MTN',
        '1234', 'RCP_instant', 'active', now() - interval '48 hours', 'fp-instant');

-- GH₵500 withdrawable.
select public.post_ledger_transaction('test_credit', 'test:instant:credit', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', 50000),
    jsonb_build_object('kind', 'seller_available', 'seller_account_id', '51510000-0000-4000-8000-0000000000a1',
                       'amount_minor', -50000)),
  '51510000-0000-4000-8000-0000000000a1');

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"51510000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;

select throws_ok($$select public.request_seller_payout(20000, 'k-unverified', 'instant')$$,
  '55000', null, 'an unverified seller cannot withdraw instantly');
select throws_ok($$select public.request_seller_payout(20000, 'k-bad', 'teleport')$$,
  '22023', null, 'an unknown speed is refused');

reset role;
insert into public.seller_verifications (seller_account_id, state, provider, provider_reference, checked_at)
values ('51510000-0000-4000-8000-0000000000a1', 'verified', 'operator', 'test', now())
on conflict (seller_account_id) do update
  set state = 'verified', provider = 'operator', provider_reference = 'test', checked_at = now();
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"51510000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;
select throws_ok($$select public.request_seller_payout(20000, 'k-new', 'instant')$$,
  '55000', null, 'a verified seller with no established track record still waits');
reset role;

insert into public.seller_trust_scores (seller_account_id, score, tier, components, weights_version)
values ('51510000-0000-4000-8000-0000000000a1', 70, 'silver', '{}'::jsonb, 'v1');

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"51510000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;
select lives_ok($$select public.request_seller_payout(20000, 'k-instant', 'instant')$$,
  'a verified, established seller withdraws instantly');
reset role;

select is((select row(speed, fee_minor, net_minor, not_before is null)::text
             from public.payout_requests where idempotency_key = 'k-instant'),
  '(instant,200,19800,t)', 'instant costs max(flat 100, floor 150, 1% = 200) and is due now');
select is((select count(*)::int from public.claim_payout_for_transfer(
             (select id from public.payout_requests where idempotency_key = 'k-instant'))),
  1, 'an instant payout can be claimed immediately');

-- Settle it so a second withdrawal is allowed (one open at a time).
update public.payout_requests set status = 'paid' where idempotency_key = 'k-instant';

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"51510000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;
select lives_ok($$select public.request_seller_payout(10000, 'k-standard')$$,
  'the original two-argument call still works and means standard');
reset role;

select is((select row(speed, fee_minor)::text from public.payout_requests where idempotency_key = 'k-standard'),
  '(standard,100)', 'standard keeps the flat fee');
select ok((select not_before > now() and extract(hour from not_before at time zone 'UTC') = 9
             from public.payout_requests where idempotency_key = 'k-standard'),
  'standard waits for the next 09:00 GMT batch');
select is((select count(*)::int from public.claim_payout_for_transfer(
             (select id from public.payout_requests where idempotency_key = 'k-standard'))),
  0, 'a standard payout cannot be claimed before its batch');

select * from finish();
rollback;
