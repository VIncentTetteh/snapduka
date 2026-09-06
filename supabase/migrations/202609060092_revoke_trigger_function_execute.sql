-- Trigger functions should not be in the REST API.
--
-- Postgres grants EXECUTE to PUBLIC on every function at creation, and
-- PostgREST exposes anything the caller can execute at /rest/v1/rpc/<name>. Two
-- trigger functions were left with that default grant, so both appear in the
-- public API surface — and campaign_links_guard_destination is SECURITY
-- DEFINER, which is what the linter flags.
--
-- Being straight about the severity: this is not exploitable. Calling a trigger
-- function directly raises 0A000, "trigger functions can only be called as
-- triggers", before any of its body runs, and neither takes arguments. Nothing
-- can be read or written through them today.
--
-- It is still worth closing. The grant serves no purpose, it puts two functions
-- in an API surface that is meant to be deliberate, and the property that keeps
-- it harmless is a Postgres implementation detail rather than anything this
-- schema asserts. Every other function here is granted deliberately; these two
-- were simply never revoked.

revoke execute on function public.campaign_links_guard_destination() from public, anon, authenticated;
revoke execute on function public.product_reviews_guard_buyer_content() from public, anon, authenticated;

-- The property: no trigger function is reachable from the REST API.
do $$
declare exposed text;
begin
  select string_agg(p.proname, ', ')
  into exposed
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if exposed is not null then
    raise exception 'Trigger functions still callable over REST: %', exposed;
  end if;
end $$;
