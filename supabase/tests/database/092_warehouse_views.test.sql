-- Warehouse views (202609250242): no contact details and no raw uuids leave,
-- pseudonyms are keyed and join across views, and only warehouse_reader can
-- read them — without being able to read the salt or the base tables.

begin;

set local search_path = extensions, public;

select plan(21);

-- ---------------------------------------------------------------------------
-- Shape: nothing identifying is even a column.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.views where table_schema = 'warehouse'),
  12, 'twelve warehouse views');

select is(
  (select coalesce(string_agg(table_name || '.' || column_name, ', '), '')
     from information_schema.columns
    where table_schema = 'warehouse'
      and (column_name ~ '(^|_)(email|phone|name|address|snapshot|token|reference|destination|description|resolution|note|preview|raw|hash|context|metadata|error)($|_)'
           or column_name = 'event_key')
      and column_name <> 'buyer_phone_key'),
  '', 'no view exposes a contact, free-text, token or provider-payload column');

select is(
  (select coalesce(string_agg(table_name || '.' || column_name, ', '), '')
     from information_schema.columns
    where table_schema = 'warehouse' and data_type = 'uuid'),
  '', 'no raw uuid leaves: every identifier is a keyed pseudonym');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('09200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'wh-seller@example.com', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, contact_phone)
values ('09200000-0000-4000-8000-0000000000a1', '09200000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Warehouse Seller', 'wh-seller@example.com', '+233241119201');
insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('09200000-0000-4000-8000-0000000000b1', '09200000-0000-4000-8000-0000000000a1',
        'wh-shop', 'WH Shop', 'WH Shop Ltd', 'GH', 'GHS', 'published', now());
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('09200000-0000-4000-8000-0000000000c1', '09200000-0000-4000-8000-0000000000a1',
        'Yaw Buyer', 'yaw@example.com', '+233241119202', 'GH');
-- The buyer typed a local-format number at checkout; WhatsApp knows E.164.
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor,
                           delivery_minor, total_minor, payment_method, fulfillment_method_snapshot,
                           buyer_snapshot)
values ('09200000-0000-4000-8000-0000000000d1', '09200000-0000-4000-8000-0000000000b1',
        '09200000-0000-4000-8000-0000000000a1', '09200000-0000-4000-8000-0000000000c1', 'GHS',
        5000, 0, 5000, 'paystack', '{}'::jsonb,
        '{"name":"Yaw","phone":"024 111 9202","country":"GH","email":"yaw@example.com"}'::jsonb);
insert into public.wa_conversations (id, buyer_phone, seller_account_id)
values ('09200000-0000-4000-8000-0000000000f1', '+233241119202', '09200000-0000-4000-8000-0000000000a1');

create temporary table t_order as
select * from warehouse.orders
 where order_key = warehouse_private.pseudonymise('order', '09200000-0000-4000-8000-0000000000d1');

-- ---------------------------------------------------------------------------
-- Pseudonyms
-- ---------------------------------------------------------------------------
select is((select count(*)::int from t_order), 1, 'the order is visible by its key');
select isnt((select seller_key from t_order),
  encode(digest('09200000-0000-4000-8000-0000000000a1', 'sha256'), 'hex'),
  'a seller key is not a plain (reversible-by-enumeration) hash of the id');
select is((select length(seller_key) from t_order), 64, 'keys are HMAC-SHA256 hex');
select isnt((select seller_key from t_order), (select customer_key from t_order),
  'different domains give different keys');
select is(
  (select seller_key from warehouse.sellers
    where seller_key = warehouse_private.pseudonymise('seller', '09200000-0000-4000-8000-0000000000a1')),
  (select seller_key from t_order), 'the seller key joins orders to sellers');
select is(
  (select buyer_phone_key from warehouse.wa_conversations
    where conversation_key = warehouse_private.pseudonymise('wa_conversation', '09200000-0000-4000-8000-0000000000f1')),
  (select buyer_phone_key from t_order),
  'a WhatsApp conversation matches its order by phone key, whatever format the buyer typed');
select is((select buyer_country from t_order), 'GH', 'only the buyer''s country survives');
select is(
  (select session_key from warehouse.analytics_events where event_type = 'checkout_completed'
      and session_key = warehouse_private.pseudonymise('session', '09200000-0000-4000-8000-0000000000d1')),
  warehouse_private.pseudonymise('session', '09200000-0000-4000-8000-0000000000d1'),
  'server funnel events are in the warehouse, pseudonymised');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(
  not exists (
    select 1 from information_schema.views v
     where v.table_schema = 'warehouse'
       and (has_table_privilege('anon', format('%I.%I', v.table_schema, v.table_name), 'select')
            or has_table_privilege('authenticated', format('%I.%I', v.table_schema, v.table_name), 'select')
            or has_table_privilege('service_role', format('%I.%I', v.table_schema, v.table_name), 'select'))),
  'no API role can read a warehouse view');
select ok(
  not exists (
    select 1 from information_schema.views v
     where v.table_schema = 'warehouse'
       and not has_table_privilege('warehouse_reader', format('%I.%I', v.table_schema, v.table_name), 'select')),
  'warehouse_reader can read every warehouse view');
select ok(not has_schema_privilege('warehouse_reader', 'warehouse_private', 'usage'),
  'warehouse_reader cannot reach the salt''s schema');
select ok(not has_table_privilege('warehouse_reader', 'warehouse_private.pseudonym_salt', 'select')
      and not has_table_privilege('service_role', 'warehouse_private.pseudonym_salt', 'select')
      and not has_table_privilege('authenticated', 'warehouse_private.pseudonym_salt', 'select'),
  'nobody but the owner can read the salt');
select ok(not has_function_privilege('warehouse_reader', 'warehouse_private.pseudonymise(text, text)', 'execute'),
  'warehouse_reader cannot mint pseudonyms (which would let it test guesses)');
select ok(not has_schema_privilege('anon', 'warehouse', 'usage')
      and not has_schema_privilege('authenticated', 'warehouse', 'usage'),
  'the warehouse schema is closed to API roles');

-- Reading as the reader role itself. pgTAP lives in a schema the reader cannot
-- use, so the probes record their SQLSTATE and are asserted afterwards.
create temporary table t_probe (probe text primary key, sqlstate text);
grant insert on t_probe to warehouse_reader;
grant warehouse_reader to postgres;
set local role warehouse_reader;
do $$
declare
  probes text[][] := array[
    ['view', 'select count(*) from warehouse.orders'],
    ['base', 'select count(*) from public.orders'],
    ['salt', 'select salt from warehouse_private.pseudonym_salt']];
  i int;
begin
  for i in 1 .. array_length(probes, 1) loop
    begin
      execute probes[i][2];
      insert into pg_temp.t_probe values (probes[i][1], 'ok');
    exception when others then
      insert into pg_temp.t_probe values (probes[i][1], sqlstate);
    end;
  end loop;
end;
$$;
reset role;

select is((select sqlstate from t_probe where probe = 'view'), 'ok', 'the reader reads the redacted view');
select is((select sqlstate from t_probe where probe = 'base'), '42501',
  'the reader cannot read the base table the view redacts');
select is((select sqlstate from t_probe where probe = 'salt'), '42501', 'the reader cannot read the salt');

select is((select count(*)::int from public.check_ledger_invariants()), 0, 'ledger invariants hold');

select * from finish();
rollback;
