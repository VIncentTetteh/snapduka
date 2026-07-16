begin;

set local search_path = extensions, public;

select plan(6);

select has_table('public', 'social_accounts', 'social_accounts table exists');
select has_column('public', 'social_accounts', 'access_token_sealed', 'stores sealed access token');
select has_column('public', 'social_accounts', 'provider', 'has provider');

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.social_accounts'::regclass),
  'social_accounts forces row level security'
);

select policies_are(
  'public',
  'social_accounts',
  array['social_accounts_owner_read', 'social_accounts_owner_delete'],
  'owner read/delete are the only client policies'
);

select throws_ok(
  $$
    insert into public.social_accounts (seller_account_id, provider, external_id, access_token_sealed)
    values (gen_random_uuid(), 'myspace', 'x', 'v1.a.b.c')
  $$,
  '23514',
  null,
  'unknown providers are rejected'
);

select * from finish();

rollback;
