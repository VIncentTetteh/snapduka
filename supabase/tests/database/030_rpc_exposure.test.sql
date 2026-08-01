-- Nothing in the public schema may be callable by anon.
--
-- On 2026-08-01, anon could POST /rest/v1/rpc/apply_paystack_success with a
-- hand-written payload and mark any order paid — free goods. Postgres grants
-- EXECUTE to PUBLIC on function creation, and the migrations granted to
-- service_role without ever revoking from PUBLIC.
--
-- This is easy to reintroduce by accident: `create or replace function` RESETS
-- the grants to the default, so redefining any of these without re-revoking
-- silently reopens the hole. The blanket assertion below is deliberately
-- written as "zero functions", not a list, so a NEW function added without a
-- revoke fails here too rather than being quietly exposed.

begin;

set local search_path = extensions, public;

select plan(9);

-- ---------------------------------------------------------------------------
-- The invariant.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'no public function is executable by anon'
);

-- ---------------------------------------------------------------------------
-- The money paths, named individually so a failure says which one broke.
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.apply_paystack_success(text,text,jsonb)', 'execute'),
  'anon cannot mark an order paid'
);
select ok(
  not has_function_privilege('authenticated', 'public.apply_paystack_success(text,text,jsonb)', 'execute'),
  'a signed-in buyer cannot mark an order paid either'
);
select ok(
  not has_function_privilege('anon', 'public.apply_paystack_refund_event(text,text,text,jsonb)', 'execute'),
  'anon cannot settle a refund'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_order_stock(uuid,text)', 'execute'),
  'anon cannot consume or release order stock'
);
select ok(
  not has_function_privilege('anon', 'public.reserve_product_stock(uuid,uuid,integer,text,timestamptz)', 'execute'),
  'anon cannot lock a competitor''s stock'
);
select ok(
  not has_function_privilege('anon', 'public.create_guest_order_growth(uuid,uuid,jsonb,jsonb,text,text,text,text,uuid)', 'execute'),
  'anon cannot create orders directly, bypassing the route''s rate limiting'
);

-- ---------------------------------------------------------------------------
-- What must KEEP working. Over-revoking breaks checkout and the creator portal,
-- so the fix is pinned from both directions.
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.apply_paystack_success(text,text,jsonb)', 'execute'),
  'the webhook and verify paths can still confirm payment'
);
select ok(
  has_function_privilege('authenticated', 'public.request_seller_payout(bigint,text)', 'execute'),
  'sellers can still request a withdrawal'
);

select * from finish();
rollback;
