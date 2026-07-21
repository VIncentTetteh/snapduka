-- supabase/tests/database/019_revoke_direct_stock_rpc_access.test.sql
begin;

set local search_path = extensions, public;

select plan(3);

-- Confirm the direct grants are gone for both functions.
select throws_ok(
  $$ set local role authenticated; select public.reserve_product_stock(gen_random_uuid(), null, 1, 'test-ref', now() + interval '1 hour') $$,
  '42501',
  null,
  'authenticated cannot call reserve_product_stock directly'
);

select throws_ok(
  $$ set local role authenticated; select public.create_guest_order(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, '[]'::jsonb, 'test-key', 'cash_on_delivery') $$,
  '42501',
  null,
  'authenticated cannot call create_guest_order directly'
);

select throws_ok(
  $$ set local role anon; select public.create_guest_order(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, '[]'::jsonb, 'test-key-2', 'cash_on_delivery') $$,
  '42501',
  null,
  'anon cannot call create_guest_order directly'
);

select * from finish();
rollback;
