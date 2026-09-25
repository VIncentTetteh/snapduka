-- warehouse_pub (202609250242): the CDC boundary. A column not in a table's
-- list can never be replicated; a list without the primary key would make
-- every UPDATE on that table FAIL in the primary, so both are asserted.

begin;

set local search_path = extensions, public;

select plan(8);

select is((select count(*)::int from pg_publication where pubname = 'warehouse_pub'), 1,
  'warehouse_pub exists');

select is(
  (select count(*)::int from pg_publication_tables where pubname = 'warehouse_pub'),
  13, 'thirteen tables are published');

select is(
  (select coalesce(string_agg(pt.tablename, ', '), '')
     from pg_publication_tables pt
     join pg_class c on c.relname = pt.tablename
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = pt.schemaname
     join pg_index i on i.indrelid = c.oid and i.indisprimary
     join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
    where pt.pubname = 'warehouse_pub' and not (a.attname = any (pt.attnames))),
  '', 'every published column list includes its primary key (the replica identity)');

select is(
  (select coalesce(string_agg(pt.tablename || '.' || col, ', '), '')
     from pg_publication_tables pt, unnest(pt.attnames) col
    where pt.pubname = 'warehouse_pub'
      and col in ('buyer_snapshot', 'delivery_address', 'tracking_token', 'public_reference',
                  'promotion_snapshot', 'campaign_snapshot', 'fulfillment_method_snapshot',
                  'destination', 'review_reason', 'failure_reason', 'provider_transfer_code',
                  'raw', 'provider_dispute_id', 'delivery_code_hash', 'rider_token',
                  'resolution_note', 'description', 'resolution', 'buyer_phone',
                  'last_message_preview', 'contact_name', 'contact_email', 'contact_phone',
                  'auth_user_id', 'error', 'context', 'metadata', 'reason', 'event_key')
      -- support_cases.reason is a category ('item_not_received'), not free text.
      and not (pt.tablename = 'support_cases' and col = 'reason')),
  '', 'no contact, free-text, token or provider-payload column is published');

select ok(
  not exists (select 1 from pg_publication_tables
               where pubname = 'warehouse_pub'
                 and tablename in ('customers', 'buyer_profiles', 'wa_messages', 'auth_users', 'api_keys')),
  'tables that are contact data through and through are not published at all');

select is(
  (select count(*)::int from pg_replication_slots where slot_name like '%warehouse%'),
  0, 'no replication slot is created here — that waits for the vendor decision');

-- A published table still accepts writes (a bad column list breaks them).
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('09300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pub-seller@example.com', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, contact_phone)
values ('09300000-0000-4000-8000-0000000000a1', '09300000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Pub Seller', 'pub-seller@example.com', '+233241119301');

select lives_ok($$
  update public.seller_accounts set contact_name = 'Renamed Seller' where id = '09300000-0000-4000-8000-0000000000a1'
$$, 'an UPDATE on a published table succeeds');
select lives_ok($$
  delete from public.seller_accounts where id = '09300000-0000-4000-8000-0000000000a1'
$$, 'a DELETE on a published table succeeds');

select * from finish();
rollback;
