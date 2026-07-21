-- supabase/tests/database/023_case_messages_operator_only.test.sql
begin;

set local search_path = extensions, public;

select plan(6);

-- Fixture: a seller, an operator, and a support case with one seller-authored
-- message and one internal (operator_only) note.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000023101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','case-fixture@example.com','',now(),'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000023102','00000000-0000-0000-0000-000000000000','authenticated','authenticated','case-operator@example.com','',now(),'{"snapduka_role":"operator"}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000023201','00000000-0000-0000-0000-000000023101','GH','active',true,'Case Fixture Seller','case-fixture@example.com','+233241234584');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('00000000-0000-0000-0000-000000023001','00000000-0000-0000-0000-000000023201','case-fixture-shop','Case Fixture Shop','GH','GHS','published',now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('00000000-0000-0000-0000-000000023002','00000000-0000-0000-0000-000000023201','Case Fixture Customer','buyer@example.com','+233241234599','GH');

insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor, delivery_minor, total_minor, payment_method, fulfillment_method_snapshot, buyer_snapshot)
values ('00000000-0000-0000-0000-000000023003','00000000-0000-0000-0000-000000023001','00000000-0000-0000-0000-000000023201','00000000-0000-0000-0000-000000023002','GHS',1000,0,1000,'cash_on_delivery','{}'::jsonb,'{}'::jsonb);

insert into public.support_cases (id, order_id, seller_account_id, reason, description)
values ('00000000-0000-0000-0000-000000023301','00000000-0000-0000-0000-000000023003','00000000-0000-0000-0000-000000023201','item_not_received','Fixture case for operator_only RLS test');

insert into public.case_messages (id, case_id, actor_type, body, operator_only)
values
  ('00000000-0000-0000-0000-000000023401','00000000-0000-0000-0000-000000023301','seller','A message the seller wrote', false),
  ('00000000-0000-0000-0000-000000023402','00000000-0000-0000-0000-000000023301','admin','Internal fraud note', true);

select is(
  (select count(*)::int from public.case_messages where case_id = '00000000-0000-0000-0000-000000023301'),
  2,
  'both messages exist in the fixture'
);

-- As the seller who owns this case: impersonate their JWT the same way
-- 002_rls.test.sql does (set_config('request.jwt.claims', ...) + set local
-- role authenticated), then verify the policy actually filters the row set.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000023101","app_metadata":{}}',
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.case_messages where case_id = '00000000-0000-0000-0000-000000023301'),
  1,
  'the seller sees only the non-operator_only message on their own case'
);
select is(
  (select body from public.case_messages where id = '00000000-0000-0000-0000-000000023401'),
  'A message the seller wrote',
  'the seller can still read their own message'
);
select is_empty(
  $$
    select id from public.case_messages
    where id = '00000000-0000-0000-0000-000000023402'
  $$,
  'the internal fraud note is excluded from the seller-visible row set'
);

reset role;

-- As the operator: both the seller message and the internal note are visible.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000023102","app_metadata":{"snapduka_role":"operator"}}',
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.case_messages where case_id = '00000000-0000-0000-0000-000000023301'),
  2,
  'the operator sees both messages on the case'
);
select is(
  (select operator_only from public.case_messages where id = '00000000-0000-0000-0000-000000023402'),
  true,
  'the operator can read the internal fraud note directly'
);

reset role;

select * from finish();
rollback;
