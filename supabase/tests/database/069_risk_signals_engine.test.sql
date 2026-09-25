-- risk_signals as written by the risk engine (202609250145): one finding per
-- rule per subject, bounded scores, and server-only writes.

begin;

set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('69690000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'risk@test', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('69690000-0000-4000-8000-0000000000a1', '69690000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Risk Seller');

select lives_ok($$insert into public.risk_signals
    (seller_account_id, signal_type, score, context, rules_version, dedupe_key, details)
  values ('69690000-0000-4000-8000-0000000000a1', 'payout_velocity', 40, 'payout_request',
          '2026-09-25.1', 'payout_velocity:payout:k1', '{"payoutsLast24h":3}')$$,
  'the engine can record a finding');
select throws_ok($$insert into public.risk_signals
    (seller_account_id, signal_type, score, context, rules_version, dedupe_key)
  values ('69690000-0000-4000-8000-0000000000a1', 'payout_velocity', 40, 'payout_request',
          '2026-09-25.1', 'payout_velocity:payout:k1')$$,
  '23505', null, 'a retried request cannot record the same finding twice');

-- What the app does on a retry: ON CONFLICT DO NOTHING.
insert into public.risk_signals (seller_account_id, signal_type, score, context, rules_version, dedupe_key)
values ('69690000-0000-4000-8000-0000000000a1', 'payout_velocity', 40, 'payout_request',
        '2026-09-25.1', 'payout_velocity:payout:k1')
on conflict (dedupe_key) do nothing;
select is((select count(*)::int from public.risk_signals
            where seller_account_id = '69690000-0000-4000-8000-0000000000a1'), 1,
  'and a retry is a quiet no-op');

select throws_ok($$insert into public.risk_signals (seller_account_id, signal_type, score, context)
  values ('69690000-0000-4000-8000-0000000000a1', 'x', 101, 'payout_request')$$,
  '23514', null, 'scores are bounded 0-100');
select throws_ok($$insert into public.risk_signals (seller_account_id, signal_type, score, context)
  values ('69690000-0000-4000-8000-0000000000a1', 'x', 10, 'somewhere')$$,
  '23514', null, 'the context is one the engine knows');

select ok(not has_table_privilege('authenticated', 'public.risk_signals', 'insert'),
  'no client can write a risk signal');
select ok(not has_table_privilege('anon', 'public.risk_signals', 'select'),
  'buyers cannot read risk signals');

select * from finish();
rollback;
