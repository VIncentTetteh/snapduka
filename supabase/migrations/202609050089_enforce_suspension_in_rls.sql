-- Make suspension mean something in the database.
--
-- Suspending a seller is the platform's strongest lever short of closing an
-- account, and it was almost entirely an application-layer convention. Two
-- separate gaps:
--
-- 1. Twenty-four owner-scoped write policies had no status test at all, so a
--    suspended seller could still mint an API key, create a discount code,
--    register an outbound webhook, invite a creator, or re-list themselves in
--    public discovery. The web app masks some of this in server actions, but
--    both mobile clients write straight to PostgREST with the user's JWT, so
--    for them nothing masked it.
--
-- 2. The sixteen policies that *did* carry the test only carried it in USING.
--    For an ALL policy, INSERT is governed by WITH CHECK alone — so a suspended
--    seller could not read or update their collections but could happily insert
--    new ones. Verified against production: a suspended seller successfully
--    inserted into both `collections` (guarded) and `promotions` (unguarded).
--
-- The predicate matches the one already used here: 'pending' and 'active' both
-- pass, because pending is every seller between signup and verification and
-- blocking them would break onboarding. Only suspended and closed are refused.
--
-- Policies are rewritten from their own stored expressions rather than
-- retyped, so this cannot accidentally widen a policy while narrowing another —
-- the existing predicate is preserved verbatim and the status test is ANDed on.

do $$
declare
  r record;
  v_status constant text :=
    '((select public.current_seller_status()) = any (array[''pending''::public.seller_account_status, ''active''::public.seller_account_status]))';
  v_using text;
  v_check text;
  v_roles text;
  v_sql text;
  v_count int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.qual, p.with_check, p.roles
    from pg_policies p
    where p.schemaname = 'public'
      and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%current_seller_account_id()%'
      -- Deliberately exempt. Each of these is something a suspended seller
      -- should still be able to do, and blocking it would punish rather than
      -- contain:
      --   seller_accounts_owner_update  — updating their own contact details,
      --       and closing the account, must remain possible.
      --   notifications_owner_mark_read — dismissing a notification changes
      --       nothing about the shop.
      --   preferences_owner_all         — turning off emails they can no longer
      --       act on is reasonable.
      --   social_accounts_owner_delete  — disconnecting an account is
      --       de-escalation; never block it.
      --   exports_owner_all             — getting their own data out is a
      --       portability question, not an abuse-containment one. Left as a
      --       deliberate decision rather than an oversight.
      --   courier_quotes_owner_all      — quotes are ephemeral and attached to
      --       orders that already exist.
      and p.policyname not in (
        'seller_accounts_owner_update',
        'notifications_owner_mark_read',
        'preferences_owner_all',
        'social_accounts_owner_delete',
        'exports_owner_all',
        'courier_quotes_owner_all'
      )
  loop
    -- Skip anything already carrying the test in BOTH places.
    if coalesce(r.qual, '') like '%current_seller_status%'
       and (r.with_check is null or r.with_check like '%current_seller_status%') then
      continue;
    end if;

    v_roles := array_to_string(r.roles, ', ');

    v_using := case
      when r.qual is null then null
      when r.qual like '%current_seller_status%' then r.qual
      else '(' || r.qual || ') and ' || v_status
    end;

    v_check := case
      when r.with_check is null then null
      when r.with_check like '%current_seller_status%' then r.with_check
      else '(' || r.with_check || ') and ' || v_status
    end;

    v_sql := format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute v_sql;

    v_sql := format('create policy %I on public.%I as permissive for %s to %s',
                    r.policyname, r.tablename, r.cmd, v_roles);
    if v_using is not null then
      v_sql := v_sql || ' using (' || v_using || ')';
    end if;
    if v_check is not null then
      v_sql := v_sql || ' with check (' || v_check || ')';
    end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice 'suspension enforced on % policies', v_count;
end $$;

-- The property, asserted rather than assumed: no owner-scoped write policy may
-- allow a write without testing account status, in either direction.
do $$
declare gaps text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
  into gaps
  from pg_policies
  where schemaname = 'public'
    and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%current_seller_account_id()%'
    and policyname not in (
      'seller_accounts_owner_update',
      'notifications_owner_mark_read',
      'preferences_owner_all',
      'social_accounts_owner_delete',
      'exports_owner_all',
      'courier_quotes_owner_all'
    )
    and (
      (qual is not null and qual not like '%current_seller_status%')
      or (with_check is not null and with_check not like '%current_seller_status%')
    );

  if gaps is not null then
    raise exception 'These owner write policies still ignore suspension: %', gaps;
  end if;
end $$;
