-- The ledger is the only record of whose money SnapDuka is holding, so its
-- guarantees are pinned here rather than left to review.

begin;

set local search_path = extensions, public;

select plan(23);

-- Fixtures follow the pattern in 026_creator_commission_lifecycle.test.sql.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('55550000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ledger@invariants.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('66660000-0000-4000-8000-000000000001', '55550000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Ledger Seller');

select has_table('public', 'ledger_accounts', 'ledger accounts exist');
select has_table('public', 'ledger_transactions', 'ledger transactions exist');
select has_table('public', 'ledger_entries', 'ledger entries exist');
select has_table('public', 'order_settlements', 'order settlements exist');
select has_column('public', 'orders', 'fulfilled_at', 'orders carry a delivery timestamp');

-- ---------------------------------------------------------------------------
-- Only the definer function may write. RLS answers "who are you", not "do
-- these values make sense" — the same reasoning that revoked seller writes on
-- seller_subscriptions in 202607190032.
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.ledger_entries', 'insert'),
  'authenticated cannot insert ledger entries');
select ok(not has_table_privilege('service_role', 'public.ledger_entries', 'insert'),
  'not even service_role can insert ledger entries directly');
select ok(not has_function_privilege('authenticated',
  'public.post_ledger_transaction(text,text,public.currency_code,jsonb,uuid,uuid,uuid,uuid,text,jsonb)', 'execute'),
  'authenticated cannot post ledger transactions');

-- The hole this closed: a seller could INSERT a payout request for any amount.
select ok(not has_table_privilege('authenticated', 'public.payout_requests', 'insert'),
  'sellers cannot insert their own payout requests');
select ok(has_function_privilege('authenticated', 'public.request_seller_payout(bigint,text)', 'execute'),
  'sellers withdraw through the RPC, which checks the ledger under a lock');

-- ---------------------------------------------------------------------------
-- Double entry
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.post_ledger_transaction(
      'charge_capture', 'test:capture:1', 'GHS',
      jsonb_build_array(
        jsonb_build_object('kind','processor_clearing','amount_minor', 10000),
        jsonb_build_object('kind','seller_pending','seller_account_id','66660000-0000-4000-8000-000000000001','amount_minor', -9300),
        jsonb_build_object('kind','platform_revenue','amount_minor', -700)
      ), '66660000-0000-4000-8000-000000000001')$$,
  'a balanced transaction posts'
);

-- sum() over bigint returns numeric, so both sides are cast explicitly rather
-- than relying on an is() overload that does not exist.
select is(
  (select coalesce(sum(amount_minor), 0)::bigint from public.ledger_entries),
  0::bigint,
  'the books close to zero'
);

select is(
  (select balance_minor from public.ledger_accounts
    where kind = 'seller_pending' and owner_seller_account_id = '66660000-0000-4000-8000-000000000001'),
  9300::bigint,
  'a seller liability reads in its natural sign, not negative'
);

-- Replaying an event must not credit twice. This is the guard that matters
-- most: the webhook and the verify route reach capture by different routes.
select is(
  (select public.post_ledger_transaction(
      'charge_capture', 'test:capture:1', 'GHS',
      jsonb_build_array(
        jsonb_build_object('kind','processor_clearing','amount_minor', 10000),
        jsonb_build_object('kind','platform_revenue','amount_minor', -10000)
      ))),
  null,
  'replaying an event key is a no-op'
);

select is(
  (select count(*)::int from public.ledger_entries),
  3,
  'the replay wrote no entries'
);

select throws_ok(
  $$select public.post_ledger_transaction('bad','test:bad:1','GHS',
      jsonb_build_array(
        jsonb_build_object('kind','processor_clearing','amount_minor', 500),
        jsonb_build_object('kind','platform_revenue','amount_minor', -400)))$$,
  '23514', null,
  'unbalanced lines are rejected'
);

select throws_ok(
  $$select public.post_ledger_transaction('bad','test:single:1','GHS',
      jsonb_build_array(jsonb_build_object('kind','processor_clearing','amount_minor', 0)))$$,
  '22023', null,
  'a single-sided transaction is rejected'
);

-- Money a seller has not been cleared to touch must never go negative.
select throws_ok(
  $$select public.post_ledger_transaction('bad','test:neg:1','GHS',
      jsonb_build_array(
        jsonb_build_object('kind','seller_pending','seller_account_id','66660000-0000-4000-8000-000000000001','amount_minor', 99999),
        jsonb_build_object('kind','processor_clearing','amount_minor', -99999)),
      '66660000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'seller_pending cannot be driven negative'
);

-- ---------------------------------------------------------------------------
-- Append-only. A ledger you can edit is not a ledger; corrections are new
-- balancing transactions.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.ledger_entries set amount_minor = 1$$,
  '55000', null, 'entries cannot be updated'
);
select throws_ok(
  $$delete from public.ledger_entries$$,
  '55000', null, 'entries cannot be deleted'
);
select throws_ok(
  $$update public.ledger_transactions set kind = 'tampered'$$,
  '55000', null, 'transactions cannot be updated'
);

-- ---------------------------------------------------------------------------
-- The cached balance must agree with the entries it summarises, and the
-- invariant checker must notice when it does not.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.check_ledger_invariants()),
  0,
  'a healthy ledger reports no problems'
);

-- capture_order_settlement returns null for anything that is not a paystack
-- order, so offline money never invents a wallet credit. A non-existent order
-- exercises the same early return without needing seeded orders.
select is(
  (select public.capture_order_settlement(gen_random_uuid(), null, 'test', 0)),
  null,
  'capturing an unknown or non-online order posts nothing'
);

select * from finish();
rollback;
