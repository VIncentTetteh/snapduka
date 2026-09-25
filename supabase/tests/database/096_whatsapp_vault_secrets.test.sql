-- WhatsApp secrets in Vault (202609250261).

begin;

set local search_path = extensions, public;

select plan(6);

select ok(not has_function_privilege('authenticated', 'public.whatsapp_platform_secrets()', 'execute'),
  'a signed-in browser session cannot read the WhatsApp secrets');
select ok(not has_function_privilege('anon', 'public.whatsapp_platform_secrets()', 'execute'), 'nor can anon');
select ok(has_function_privilege('service_role', 'public.whatsapp_platform_secrets()', 'execute'), 'the server can');

-- Seeded values come back; the rest are null (the app then falls back to env).
-- Vault rows are created inside this transaction and rolled back with it.
do $$
begin
  perform vault.create_secret('test-app-secret', 'whatsapp_app_secret', 'test');
  perform vault.create_secret('test-access-token', 'whatsapp_access_token', 'test');
end
$$;

select is((select app_secret from public.whatsapp_platform_secrets()), 'test-app-secret', 'the app secret is read from vault');
select is((select access_token from public.whatsapp_platform_secrets()), 'test-access-token', 'the access token is read from vault');
select is(
  (select verify_token from public.whatsapp_platform_secrets()),
  (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_verify_token'),
  'an unseeded secret is null (or whatever this environment seeded)');

select * from finish();
rollback;
