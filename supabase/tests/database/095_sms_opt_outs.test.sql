-- SMS opt-out (202609250260): platform-wide suppression, consent withdrawal,
-- redelivery dedupe, START, and the seller-facing count.

begin;

set local search_path = extensions, public;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('09500000-0000-4000-8000-00000000000' || g)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'optout' || g || '@test.test', now(), now()
  from generate_series(1, 2) g;

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
select ('09510000-0000-4000-8000-00000000000' || g)::uuid, ('09500000-0000-4000-8000-00000000000' || g)::uuid,
       'GH', 'active', true, 'Seller ' || g
  from generate_series(1, 2) g;

-- The same buyer phone is a customer of BOTH sellers; a second phone only of seller 1.
insert into public.customers (id, seller_account_id, name, email, phone, country)
values
  ('09520000-0000-4000-8000-000000000001', '09510000-0000-4000-8000-000000000001', 'Ama', 'ama@test.test', '+233209500001', 'GH'),
  ('09520000-0000-4000-8000-000000000002', '09510000-0000-4000-8000-000000000002', 'Ama', 'ama@test.test', '+233209500001', 'GH'),
  ('09520000-0000-4000-8000-000000000003', '09510000-0000-4000-8000-000000000001', 'Kofi', 'kofi@test.test', '+233209500002', 'GH');

insert into public.customer_consents (customer_id, seller_account_id, purpose, status)
values
  ('09520000-0000-4000-8000-000000000001', '09510000-0000-4000-8000-000000000001', 'marketing', 'granted'),
  ('09520000-0000-4000-8000-000000000002', '09510000-0000-4000-8000-000000000002', 'marketing', 'granted'),
  ('09520000-0000-4000-8000-000000000003', '09510000-0000-4000-8000-000000000001', 'marketing', 'granted');

-- ── Privileges ──────────────────────────────────────────────────────────────
select ok(not has_table_privilege('authenticated', 'public.sms_opt_outs', 'select'), 'opt-outs are not readable by sellers');
select ok(not has_table_privilege('anon', 'public.sms_opt_outs', 'insert'), 'nor writable by anon');
select ok(not has_table_privilege('authenticated', 'public.sms_inbound_events', 'select'), 'inbound events are service-role only');
select ok(not has_function_privilege('authenticated', 'public.sms_apply_opt_keyword(text,text,text,text,text,text,uuid)', 'execute'),
  'a browser session cannot opt a number in or out');
select ok(not has_function_privilege('anon', 'public.sms_apply_opt_keyword(text,text,text,text,text,text,uuid)', 'execute'),
  'nor can anon');
select ok(not has_function_privilege('authenticated', 'public.seller_sms_suppressed_count(uuid)', 'execute'),
  'the count takes a seller id, so it is not an authenticated RPC');
select ok(has_function_privilege('service_role', 'public.sms_suppressed_phones(text[])', 'execute'), 'the worker can check suppression');

-- ── STOP ────────────────────────────────────────────────────────────────────
select results_eq(
  $$select duplicate, opted_out, consents_withdrawn
      from public.sms_apply_opt_keyword('+233209500001', 'opt_out', 'inbound_sms', 'STOP', 'sandbox', 'msg-1')$$,
  $$values (false, true, 2)$$,
  'STOP suppresses the number and withdraws marketing consent at both sellers');
select is(
  (select count(*)::int from public.customer_consents
    where customer_id in ('09520000-0000-4000-8000-000000000001', '09520000-0000-4000-8000-000000000002')
      and purpose = 'marketing' and status = 'withdrawn'),
  2, 'both sellers now record the consent as withdrawn');
select is(
  (select status::text from public.customer_consents where customer_id = '09520000-0000-4000-8000-000000000003'),
  'granted', 'a different buyer is untouched');
select set_eq(
  $$select phone from public.sms_suppressed_phones(array['+233209500001', '+233209500002', '+233209599999'])$$,
  $$values ('+233209500001')$$,
  'only the opted-out number is suppressed');
select is(public.seller_sms_suppressed_count('09510000-0000-4000-8000-000000000001'), 1, 'seller 1 sees one suppressed customer');
select is(public.seller_sms_suppressed_count('09510000-0000-4000-8000-000000000002'), 1, 'and so does seller 2, for the same buyer');

-- A redelivery of the same provider message changes nothing and says so.
select results_eq(
  $$select duplicate, opted_out, consents_withdrawn
      from public.sms_apply_opt_keyword('+233209500001', 'opt_out', 'inbound_sms', 'STOP', 'sandbox', 'msg-1')$$,
  $$values (true, true, 0)$$,
  'a redelivered STOP is a duplicate');
select is((select count(*)::int from public.sms_inbound_events where provider = 'sandbox' and provider_message_id = 'msg-1'),
  1, 'recorded once');

-- ── START ───────────────────────────────────────────────────────────────────
select results_eq(
  $$select duplicate, opted_out from public.sms_apply_opt_keyword('+233209500001', 'opt_in', 'inbound_sms', 'START', 'sandbox', 'msg-2')$$,
  $$values (false, false)$$,
  'START lifts the platform suppression');
select is(public.seller_sms_suppressed_count('09510000-0000-4000-8000-000000000001'), 0, 'no longer counted as suppressed');
select is(
  (select count(*)::int from public.customer_consents
    where customer_id in ('09520000-0000-4000-8000-000000000001', '09520000-0000-4000-8000-000000000002')
      and status = 'granted'),
  0, 'START does not re-grant any seller''s marketing consent');

-- ── Operator ────────────────────────────────────────────────────────────────
select results_eq(
  $$select duplicate, opted_out, consents_withdrawn
      from public.sms_apply_opt_keyword('+233209500002', 'opt_out', 'operator', null, null, null, '09500000-0000-4000-8000-000000000001')$$,
  $$values (false, true, 1)$$,
  'an operator opt-out suppresses and withdraws the same way');
select is((select source from public.sms_opt_outs where phone = '+233209500002'), 'operator', 'and records who applied it');

-- ── Validation ──────────────────────────────────────────────────────────────
select throws_ok(
  $$select * from public.sms_apply_opt_keyword('0209500001', 'opt_out', 'operator')$$,
  '22023', null, 'a non-E.164 number is refused');
select throws_ok(
  $$select * from public.sms_apply_opt_keyword('+233209500001', 'delete_everything', 'operator')$$,
  '22023', null, 'an unknown action is refused');

select * from finish();
rollback;
