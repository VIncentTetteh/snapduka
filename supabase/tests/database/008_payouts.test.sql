begin;

set local search_path = extensions, public;

select plan(10);

select has_table('public', 'payout_requests', 'payout_requests table exists');
select has_column('public', 'payout_requests', 'seller_account_id', 'has seller_account_id');
select has_column('public', 'payout_requests', 'amount_minor', 'has amount_minor');
select has_column('public', 'payout_requests', 'fee_minor', 'has fee_minor');
select has_column('public', 'payout_requests', 'status', 'has status');
select has_column('public', 'payout_requests', 'review_reason', 'has review_reason');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.payout_requests'::regclass),
  'payout_requests has row level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.payout_requests'::regclass),
  'payout_requests forces row level security'
);

select policies_are(
  'public',
  'payout_requests',
  -- payout_requests_owner_insert was removed in 202607310061: RLS checks row
  -- ownership but not values, so it let a seller insert a request for any
  -- amount at all. Requests now go through request_seller_payout, which checks
  -- the ledger under a row lock.
  array[
    'payout_requests_owner_operator_read',
    'payout_requests_operator_update'
  ],
  'payout_requests policies are exactly the expected set'
);

-- Amount must be positive.
select throws_ok(
  $$
    insert into public.payout_requests (seller_account_id, amount_minor, currency)
    values (gen_random_uuid(), 0, 'GHS')
  $$,
  '23514',
  null,
  'zero-amount payout requests are rejected'
);

select * from finish();

rollback;
