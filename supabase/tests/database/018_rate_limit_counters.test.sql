-- supabase/tests/database/018_rate_limit_counters.test.sql
begin;

set local search_path = extensions, public;

select plan(6);

select has_table('public', 'rate_limit_counters', 'rate_limit_counters table exists');
select has_function('public', 'check_rate_limit', array['text','integer','bigint'], 'check_rate_limit function exists');

-- Allows up to the limit.
select is(
  (select allowed from public.check_rate_limit('rl-test-a', 3, 60000)),
  true,
  'first request within a fresh window is allowed'
);
select is(
  (select allowed from public.check_rate_limit('rl-test-a', 3, 60000)),
  true,
  'second request within the limit is allowed'
);
select is(
  (select count(*)::int from (
    select allowed from public.check_rate_limit('rl-test-a', 3, 60000)
    union all
    select allowed from public.check_rate_limit('rl-test-a', 3, 60000)
  ) t where allowed = false),
  1,
  'the 5th call against a limit of 3 (3 already made above) is blocked'
);

-- A different key is a fresh counter, unaffected by rl-test-a's state.
select is(
  (select allowed from public.check_rate_limit('rl-test-b', 1, 60000)),
  true,
  'a different key gets its own independent counter'
);

select * from finish();
rollback;
