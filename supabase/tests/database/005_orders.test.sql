begin;
set local search_path=extensions,public;
select plan(10);
select has_table('public','orders','orders exist');
select has_table('public','order_lines','order lines exist');
select has_function('public','create_guest_order',array['uuid','uuid','jsonb','jsonb','text','text']::name[],'atomic guest order helper exists');
select is(has_table_privilege('anon','public.orders','SELECT'),false,'buyers cannot enumerate orders');
-- create_guest_order is an internal helper only — Task 3 revoked the
-- direct grant so it can only run via create_guest_order_growth's
-- definer privileges. Buyers place orders through that wrapper RPC.
select is(has_function_privilege('anon','public.create_guest_order(uuid,uuid,jsonb,jsonb,text,text)','EXECUTE'),false,'buyers cannot call create_guest_order directly');
select is(has_function_privilege('anon','public.create_guest_order_growth(uuid,uuid,jsonb,jsonb,text,text,text,text)','EXECUTE'),true,'buyers can create orders only through the create_guest_order_growth RPC');
select is((select relforcerowsecurity from pg_class where oid='public.orders'::regclass),true,'orders force RLS');
select is((select relforcerowsecurity from pg_class where oid='public.order_lines'::regclass),true,'lines force RLS');
select has_trigger('public','order_lines','order_lines_no_update','line snapshots have an immutability trigger');
select lives_ok(
  $$select extensions.gen_random_bytes(8)$$,
  'pgcrypto random bytes are available from the extension schema'
);
select * from finish();
rollback;
