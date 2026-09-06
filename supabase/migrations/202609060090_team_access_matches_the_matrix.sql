-- Make the database agree with the permission matrix, and stop a suspended
-- account being operated by its team.
--
-- Two problems, and the second is the reason this migration is not simply an
-- expansion of access.
--
-- 1. Suspension is bypassable through any team member. 202609050089 added a
--    status test to every owner-scoped write policy, but team policies are
--    separate and OR'd alongside them, and none of them tested status. Verified
--    against production: a `manager` on a suspended account inserted a product
--    successfully. Suspending an account therefore stopped the owner working
--    and left their staff able to carry on, which is not a meaningful sanction.
--
--    current_seller_status() cannot express this: it resolves through
--    seller_accounts.auth_user_id, which is NULL for a pure team member. The
--    question a team policy needs to ask is about the account being acted on,
--    not the caller — hence seller_account_operable().
--
-- 2. The matrix grants `manager` campaigns.manage and settings.manage, and the
--    server actions for campaigns, promotions, segments, broadcasts, creators,
--    sharing and shop settings all check exactly those permissions and then
--    proceed. RLS had no team policy on any of those tables, so every one of
--    those writes was refused by the database. The permission existed, the
--    screen was reachable, and the save failed.
--
--    Aligning RLS to the matrix implements the spec rather than inventing
--    policy: the roles below are exactly the roles that hold the matching
--    permission in src/lib/auth/permissions.ts. Tables the app guards as
--    owner-only — api_keys, outbound_webhooks, automation_rules, and everything
--    to do with payouts, verification or billing — deliberately get nothing,
--    because those actions check `actor.role` rather than a permission.

-- ── Is this account allowed to operate at all? ──────────────────────────────
create or replace function public.seller_account_operable(p_seller_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.seller_accounts
    where id = p_seller_account_id
      and status = any (array['pending'::public.seller_account_status,
                              'active'::public.seller_account_status])
  );
$$;

comment on function public.seller_account_operable(uuid) is
  'True when the account may still be operated. Asks about the account, not the caller, so team policies can use it.';

revoke execute on function public.seller_account_operable(uuid) from public, anon;
grant execute on function public.seller_account_operable(uuid) to authenticated, service_role;

-- ── Existing team policies gain the suspension test ─────────────────────────
-- Rewritten from their own stored expressions, so the role list each one
-- already carries is preserved exactly and only the status test is added.
do $$
declare
  r record;
  v_using text; v_check text; v_roles text; v_sql text; v_count int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.qual, p.with_check, p.roles
    from pg_policies p
    where p.schemaname = 'public'
      and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%team_has_role%'
      and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%seller_account_operable%'
  loop
    v_roles := array_to_string(r.roles, ', ');
    v_using := case when r.qual is null then null
      else '(' || r.qual || ') and public.seller_account_operable(' || quote_ident(r.tablename) || '.seller_account_id)' end;
    v_check := case when r.with_check is null then null
      else '(' || r.with_check || ') and public.seller_account_operable(' || quote_ident(r.tablename) || '.seller_account_id)' end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    v_sql := format('create policy %I on public.%I as permissive for %s to %s',
                    r.policyname, r.tablename, r.cmd, v_roles);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
    v_count := v_count + 1;
  end loop;
  raise notice 'suspension test added to % existing team write policies', v_count;
end $$;

-- ── New team policies, one permission at a time ─────────────────────────────
-- campaigns.manage is held by owner and manager. `owner` is not a team_role —
-- the owner is covered by the owner policy — so these name `manager` alone.
do $$
declare t text;
begin
  foreach t in array array[
    'campaigns', 'campaign_products', 'campaign_links', 'marketing_broadcasts',
    'customer_segments', 'promotions', 'creator_invitations', 'creator_partnerships'
  ] loop
    execute format($f$
      create policy %I on public.%I as permissive for all to authenticated
      using (
        (select public.team_has_role(%I.seller_account_id, array['manager'::public.team_role]))
        and public.seller_account_operable(%I.seller_account_id)
      )
      with check (
        (select public.team_has_role(%I.seller_account_id, array['manager'::public.team_role]))
        and public.seller_account_operable(%I.seller_account_id)
      )
    $f$, t || '_team_manage', t, t, t, t, t);
  end loop;
end $$;

-- settings.manage, likewise owner and manager.
do $$
declare t text;
begin
  foreach t in array array[
    'shop_branding', 'custom_domains', 'discovery_preferences', 'notification_preferences'
  ] loop
    execute format($f$
      create policy %I on public.%I as permissive for all to authenticated
      using (
        (select public.team_has_role(%I.seller_account_id, array['manager'::public.team_role]))
        and public.seller_account_operable(%I.seller_account_id)
      )
      with check (
        (select public.team_has_role(%I.seller_account_id, array['manager'::public.team_role]))
        and public.seller_account_operable(%I.seller_account_id)
      )
    $f$, t || '_team_manage', t, t, t, t, t);
  end loop;
end $$;

-- Disconnecting a linked social account is part of running campaigns.
create policy social_accounts_team_delete on public.social_accounts
  as permissive for delete to authenticated
  using (
    (select public.team_has_role(social_accounts.seller_account_id, array['manager'::public.team_role]))
    and public.seller_account_operable(social_accounts.seller_account_id)
  );

-- Tagging a customer is support work; analyst holds customers.read but is a
-- read-only role, so it is deliberately absent. This mirrors the roles on
-- customer_consents rather than the wider customers_team_read.
create policy customer_tags_team_manage on public.customer_tags
  as permissive for all to authenticated
  using (
    (select public.team_has_role(customer_tags.seller_account_id,
                                 array['manager'::public.team_role, 'support'::public.team_role]))
    and public.seller_account_operable(customer_tags.seller_account_id)
  )
  with check (
    (select public.team_has_role(customer_tags.seller_account_id,
                                 array['manager'::public.team_role, 'support'::public.team_role]))
    and public.seller_account_operable(customer_tags.seller_account_id)
  );

-- ── The property ────────────────────────────────────────────────────────────
do $$
declare gaps text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
  into gaps
  from pg_policies
  where schemaname = 'public'
    and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%team_has_role%'
    and (coalesce(qual, '') || coalesce(with_check, '')) not like '%seller_account_operable%';

  if gaps is not null then
    raise exception 'These team write policies let a suspended account keep operating: %', gaps;
  end if;
end $$;
