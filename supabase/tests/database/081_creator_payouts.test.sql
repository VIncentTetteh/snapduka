-- Creator withdrawals and creator-ledger isolation (202609250201, 0203).
--
-- Creator payouts ride the seller payout machinery (one worker, one webhook),
-- so this pins both that the creator path moves the creator's money — reserve,
-- settle, fail, reverse, reject — and that the generalised seller path still
-- moves the seller's. Then who can read what: a creator reads only their own
-- ledger, another creator none of it, and a seller none of it.

begin;

set local search_path = extensions, public;

select plan(53);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
update public.country_configs
   set payouts_enabled = false, payout_fee_minor = 100, minimum_payout_minor = 5000,
       payout_auto_approve_max_minor = 100000, payout_daily_cap_minor = null
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('81810000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'creator-1@cp.test', now(), now()),
  ('81810000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'creator-2@cp.test', now(), now()),
  ('81810000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller@cp.test', now(), now());

insert into public.creators (id, auth_user_id, handle, display_name, contact_phone, country)
values
  ('81810000-0000-4000-8000-0000000000c1', '81810000-0000-4000-8000-000000000001', 'cp_creator_1', 'Creator One', '+233201230001', 'GH'),
  ('81810000-0000-4000-8000-0000000000c2', '81810000-0000-4000-8000-000000000002', 'cp_creator_2', 'Creator Two', '+233201230002', 'GH');

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, settlement_mode_override)
values ('81810000-0000-4000-8000-0000000000a1', '81810000-0000-4000-8000-000000000003', 'GH', 'active', true, 'CP Seller', 'ledger');

-- Money to withdraw. Posted directly (as 029 does) so this file tests the
-- payout path alone; 080 covers how commissions reach creator_available.
select public.post_ledger_transaction('test_fund', 'cp-fund-c1', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', 30000),
    jsonb_build_object('kind', 'creator_available', 'creator_id', '81810000-0000-4000-8000-0000000000c1', 'amount_minor', -30000)));
select public.post_ledger_transaction('test_fund', 'cp-fund-c2', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', 20000),
    jsonb_build_object('kind', 'creator_available', 'creator_id', '81810000-0000-4000-8000-0000000000c2', 'amount_minor', -20000)));
select public.post_ledger_transaction('test_fund', 'cp-fund-s1', 'GHS',
  jsonb_build_array(
    jsonb_build_object('kind', 'processor_clearing', 'amount_minor', 20000),
    jsonb_build_object('kind', 'seller_available', 'seller_account_id', '81810000-0000-4000-8000-0000000000a1', 'amount_minor', -20000)));

create or replace function pg_temp.bal(p_kind text, p_owner uuid) returns bigint language sql as $$
  select coalesce(sum(balance_minor), 0)::bigint from public.ledger_accounts
   where kind::text = p_kind and currency = 'GHS'
     and (owner_seller_account_id = p_owner or owner_creator_id = p_owner);
$$;

create or replace function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', p_sub, 'app_metadata', json_build_object())::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Exposure
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.request_creator_payout(bigint,text)', 'execute'),
  'creators withdraw through the RPC');
select ok(has_function_privilege('authenticated', 'public.creator_wallet_balances(uuid)', 'execute'),
  'creators read their wallet through the RPC');
select ok(not has_function_privilege('authenticated',
  'public.ledger_account_for_creator(public.ledger_account_kind,public.currency_code,uuid)', 'execute'),
  'authenticated cannot resolve creator accounts');
select ok(not has_function_privilege('authenticated', 'public.post_creator_commission_accrual(uuid)', 'execute'),
  'authenticated cannot accrue a commission');
select ok(not has_function_privilege('authenticated', 'public.release_creator_commission(uuid)', 'execute'),
  'authenticated cannot release a commission');
select ok(not has_function_privilege('authenticated',
  'public.reserve_creator_payout_destination(uuid,public.currency_code,text,text,text,text,text)', 'execute'),
  'authenticated cannot create a destination without the Paystack exchange');
select ok(not has_table_privilege('authenticated', 'public.payout_requests', 'insert'),
  'creators cannot insert payout requests directly either');

-- Posting shape: creator kinds need creator_id and nothing else may carry it.
select throws_ok(
  $$select public.post_ledger_transaction('bad', 'cp-bad-1', 'GHS', jsonb_build_array(
      jsonb_build_object('kind', 'creator_available', 'amount_minor', 1),
      jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -1)))$$,
  '22023', null, 'a creator line without its creator is refused');
select throws_ok(
  $$select public.post_ledger_transaction('bad', 'cp-bad-2', 'GHS', jsonb_build_array(
      jsonb_build_object('kind', 'platform_revenue', 'creator_id', '81810000-0000-4000-8000-0000000000c1', 'amount_minor', 1),
      jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -1)))$$,
  '22023', null, 'a platform line carrying a creator is refused');
select throws_ok(
  $$select public.ledger_account_for('creator_pending', 'GHS', null)$$,
  '22023', null, 'the seller resolver refuses creator kinds, so it cannot match every creator at once');
select throws_ok(
  $$select public.post_ledger_transaction('bad', 'cp-bad-3', 'GHS', jsonb_build_array(
      jsonb_build_object('kind', 'creator_pending', 'creator_id', '81810000-0000-4000-8000-0000000000c1', 'amount_minor', 1),
      jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -1)))$$,
  '23514', null, 'creator_pending cannot be driven negative');

-- ---------------------------------------------------------------------------
-- Requesting
-- ---------------------------------------------------------------------------
select pg_temp.as_user('81810000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.request_creator_payout(6000)$$, '55000', null,
  'nothing can be withdrawn while the market''s payouts are off');
reset role;

update public.country_configs set payouts_enabled = true where country = 'GH';

select pg_temp.as_user('81810000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.request_creator_payout(6000)$$, '55000', null,
  'a creator without a destination cannot withdraw');
reset role;

insert into public.payout_destinations (creator_id, currency, type, bank_code, bank_name, account_last4,
                                        recipient_code, status, activated_at, request_fingerprint)
values
  ('81810000-0000-4000-8000-0000000000c1', 'GHS', 'mobile_money', 'MTN', 'MTN', '1111', 'RCP_creator_1', 'active', now() - interval '48 hours', 'cp-fp-1'),
  ('81810000-0000-4000-8000-0000000000c2', 'GHS', 'mobile_money', 'MTN', 'MTN', '2222', 'RCP_creator_2', 'active', now(), 'cp-fp-2');
insert into public.payout_destinations (seller_account_id, currency, type, bank_code, bank_name, account_last4,
                                        recipient_code, status, activated_at, request_fingerprint)
values ('81810000-0000-4000-8000-0000000000a1', 'GHS', 'mobile_money', 'MTN', 'MTN', '3333', 'RCP_seller_1', 'active', now() - interval '48 hours', 'cp-fp-3');

select throws_ok(
  $$insert into public.payout_destinations (creator_id, seller_account_id, currency, type, bank_code, bank_name,
      account_last4, request_fingerprint)
    values ('81810000-0000-4000-8000-0000000000c1', '81810000-0000-4000-8000-0000000000a1', 'GHS', 'bank', 'X', 'X', '9999', 'cp-fp-both')$$,
  '23514', null, 'a destination belongs to a seller or a creator, never both');

select pg_temp.as_user('81810000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.request_creator_payout(6000)$$, '55000', null,
  'a freshly changed destination is in its 24-hour cool-off');
reset role;

select pg_temp.as_user('81810000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.request_creator_payout(1000)$$, '55000', null,
  'a withdrawal below the minimum is refused');
select throws_ok($$select public.request_creator_payout(999999)$$, '55000', null,
  'a withdrawal above the available balance is refused');
select lives_ok($$select public.request_creator_payout(6000, 'cp-idem-1')$$, 'a valid withdrawal is accepted');
select is(public.request_creator_payout(6000, 'cp-idem-1'),
  (select id from public.payout_requests where idempotency_key = 'cp-idem-1'),
  'a double submit returns the same withdrawal');
select throws_ok($$select public.request_creator_payout(5000)$$, '55000', null,
  'a second open withdrawal is refused');
reset role;

select is(pg_temp.bal('creator_available', '81810000-0000-4000-8000-0000000000c1'), 24000::bigint,
  'the amount left the creator''s available balance at once');
select is(pg_temp.bal('creator_payout_reserved', '81810000-0000-4000-8000-0000000000c1'), 6000::bigint,
  'and is held in the creator''s reserve');
select ok(
  (select creator_id = '81810000-0000-4000-8000-0000000000c1' and seller_account_id is null
          and status = 'approved' and speed = 'standard' and not_before > now() and net_minor = 5900
     from public.payout_requests where idempotency_key = 'cp-idem-1'),
  'the request is the creator''s, auto-approved, and waits for the daily batch');

-- ---------------------------------------------------------------------------
-- Executing: the seller worker's own claim/transfer/webhook path
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.claim_payout_for_transfer(
     (select id from public.payout_requests where idempotency_key = 'cp-idem-1'))),
  0, 'a standard withdrawal is not claimed before its batch');

update public.payout_requests set not_before = now() - interval '1 minute' where idempotency_key = 'cp-idem-1';
select is(
  (select recipient_code from public.claim_payout_for_transfer(
     (select id from public.payout_requests where idempotency_key = 'cp-idem-1'))),
  'RCP_creator_1', 'the worker claims it and gets the creator''s recipient');

select ok(public.apply_paystack_transfer_event('cp-transfer-1',
  (select reference from public.payout_requests where idempotency_key = 'cp-idem-1'),
  't-1', 'success', '{"data":{"fee":50}}'::jsonb), 'transfer.success settles it');
select is((select status from public.payout_requests where idempotency_key = 'cp-idem-1'), 'paid',
  'the creator''s withdrawal is paid');
select is(pg_temp.bal('creator_payout_reserved', '81810000-0000-4000-8000-0000000000c1'), 0::bigint,
  'the creator''s reserve clears');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'invariants are clean after settlement');

-- Reversed after success: money back to available.
select ok(public.apply_paystack_transfer_event('cp-transfer-1r',
  (select reference from public.payout_requests where idempotency_key = 'cp-idem-1'),
  't-1', 'reversed', '{"data":{"fee":50}}'::jsonb), 'a later reversal is applied');
select is(pg_temp.bal('creator_available', '81810000-0000-4000-8000-0000000000c1'), 30000::bigint,
  'a reversed transfer returns the whole amount to the creator');

-- Failed before settling: reservation returned.
select pg_temp.as_user('81810000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.request_creator_payout(7000, 'cp-idem-2')$$, 'a second withdrawal is accepted');
reset role;
select ok(public.apply_paystack_transfer_event('cp-transfer-2',
  (select reference from public.payout_requests where idempotency_key = 'cp-idem-2'),
  't-2', 'failed', '{"data":{"reason":"Account closed"}}'::jsonb), 'transfer.failed is applied');
select is(pg_temp.bal('creator_available', '81810000-0000-4000-8000-0000000000c1'), 30000::bigint,
  'a failed transfer gives the reservation back');
select is(pg_temp.bal('creator_payout_reserved', '81810000-0000-4000-8000-0000000000c1'), 0::bigint,
  'and nothing stays reserved');

-- Rejected by an operator: the reservation comes back too.
update public.country_configs set payout_auto_approve_max_minor = 1000 where country = 'GH';
select pg_temp.as_user('81810000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.request_creator_payout(8000, 'cp-idem-3')$$, 'a large withdrawal is accepted for review');
reset role;
select is((select status from public.payout_requests where idempotency_key = 'cp-idem-3'), 'requested',
  'above the auto-approve ceiling it waits for an operator');
update public.payout_requests set status = 'rejected', review_reason = 'test' where idempotency_key = 'cp-idem-3';
select is(pg_temp.bal('creator_available', '81810000-0000-4000-8000-0000000000c1'), 30000::bigint,
  'rejecting it returns the reservation to the creator');

-- The same for a seller: rejecting used to strand the money in reserve.
select pg_temp.as_user('81810000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok($$select public.request_seller_payout(8000, 'cp-idem-s1')$$, 'a seller''s large withdrawal is accepted');
reset role;
update public.payout_requests set status = 'rejected', review_reason = 'test' where idempotency_key = 'cp-idem-s1';
select is(pg_temp.bal('seller_available', '81810000-0000-4000-8000-0000000000a1'), 20000::bigint,
  'rejecting a seller''s withdrawal returns it to their available balance');
select is(pg_temp.bal('seller_payout_reserved', '81810000-0000-4000-8000-0000000000a1'), 0::bigint,
  'and nothing is stranded in the seller''s reserve');
update public.country_configs set payout_auto_approve_max_minor = 100000 where country = 'GH';

-- The seller path through the generalised webhook is unchanged.
select pg_temp.as_user('81810000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok($$select public.request_seller_payout(6000, 'cp-idem-s2')$$, 'a seller withdrawal is accepted');
reset role;
select ok(public.apply_paystack_transfer_event('cp-transfer-s2',
  (select reference from public.payout_requests where idempotency_key = 'cp-idem-s2'),
  't-s2', 'success', '{"data":{"fee":0}}'::jsonb), 'the seller''s transfer settles');
select ok(pg_temp.bal('seller_available', '81810000-0000-4000-8000-0000000000a1') = 14000
          and pg_temp.bal('seller_payout_reserved', '81810000-0000-4000-8000-0000000000a1') = 0,
  'the seller''s own accounts moved, and no creator''s');
select is((select coalesce(sum(amount_minor), 0)::bigint from public.ledger_entries), 0::bigint,
  'the books close across every payout path');
select is((select count(*)::int from public.check_ledger_invariants()), 0, 'invariants are clean after every payout path');

-- ---------------------------------------------------------------------------
-- Who reads what
-- ---------------------------------------------------------------------------
select pg_temp.as_user('81810000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select count(*)::int from public.ledger_accounts
    where owner_creator_id is distinct from '81810000-0000-4000-8000-0000000000c1'),
  0, 'a creator reads only their own ledger accounts');
select is(
  (select available_minor from public.creator_wallet_balances() where currency = 'GHS'),
  30000::bigint, 'a creator reads their own wallet');
select is(
  (select count(*)::int from public.payout_requests where creator_id = '81810000-0000-4000-8000-0000000000c1'),
  3, 'a creator reads their own withdrawals');
select is((select count(*)::int from public.creator_payout_destination()), 1,
  'a creator reads their own destination, without its recipient code');
reset role;

select pg_temp.as_user('81810000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.ledger_entries where creator_id = '81810000-0000-4000-8000-0000000000c1'),
  0, 'another creator reads none of that creator''s entries');
select throws_ok(
  $$select * from public.creator_wallet_balances('81810000-0000-4000-8000-0000000000c1')$$,
  '42501', null, 'another creator cannot read that creator''s wallet by id');
reset role;

select pg_temp.as_user('81810000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*)::int from public.ledger_accounts where owner_creator_id is not null)
  + (select count(*)::int from public.ledger_entries where creator_id is not null)
  + (select count(*)::int from public.payout_requests where creator_id is not null),
  0, 'a seller reads no creator accounts, entries or withdrawals');
reset role;

select * from finish();
rollback;
