-- Evaluate auth.uid() once per statement, not once per row.
--
-- A bare auth.uid() inside a policy is re-run for every row the policy is
-- tested against. Wrapping it in a scalar subquery makes Postgres hoist it into
-- an InitPlan and evaluate it a single time. The semantics are identical —
-- auth.uid() is STABLE, so its value cannot change within a statement — which is
-- why this is a rewrite rather than a behaviour change.
--
-- Every other policy in this schema already uses the wrapped form; these four
-- were the only ones left, which is also why they were easy to miss.
--
-- team_memberships is the one that actually matters: it is read on the way to
-- resolving a team member's permissions, so it sits in front of a lot of other
-- work.

drop policy policy_acceptances_owner_insert on public.policy_acceptances;
create policy policy_acceptances_owner_insert on public.policy_acceptances
  as permissive for insert to authenticated
  with check (
    seller_account_id = (select public.current_seller_account_id())
    and accepted_by_user_id = (select auth.uid())
    and (select public.current_seller_status()) = any (
      array['pending'::public.seller_account_status, 'active'::public.seller_account_status])
  );

drop policy invitations_owner_all on public.team_invitations;
create policy invitations_owner_all on public.team_invitations
  as permissive for all to authenticated
  using (
    seller_account_id in (
      select seller_accounts.id from public.seller_accounts
      where seller_accounts.auth_user_id = (select auth.uid()))
  )
  with check (
    seller_account_id in (
      select seller_accounts.id from public.seller_accounts
      where seller_accounts.auth_user_id = (select auth.uid()))
  );

drop policy memberships_owner_write on public.team_memberships;
create policy memberships_owner_write on public.team_memberships
  as permissive for all to authenticated
  using (
    seller_account_id in (
      select seller_accounts.id from public.seller_accounts
      where seller_accounts.auth_user_id = (select auth.uid()))
  )
  with check (
    seller_account_id in (
      select seller_accounts.id from public.seller_accounts
      where seller_accounts.auth_user_id = (select auth.uid()))
  );

drop policy memberships_team_read on public.team_memberships;
create policy memberships_team_read on public.team_memberships
  as permissive for select to authenticated
  using (
    seller_account_id = (select public.current_seller_account_id())
    or auth_user_id = (select auth.uid())
  );

-- The property: every auth.uid() in a policy sits inside a subquery.
--
-- Detected by counting rather than by pattern-matching the surrounding text:
-- pg_policies renders the hoisted form as "( SELECT auth.uid() AS uid)", so a
-- naive regex for "auth.uid() not in parentheses" matches the wrapped form too
-- and reports policies that are already correct. Comparing total occurrences
-- against those preceded by SELECT has no such ambiguity.
do $$
declare unwrapped text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
  into unwrapped
  from (
    select tablename, policyname,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
    from pg_policies where schemaname = 'public'
  ) p
  where (length(expr) - length(replace(expr, 'auth.uid()', ''))) / length('auth.uid()')
      > (length(expr) - length(replace(expr, 'SELECT auth.uid()', ''))) / length('SELECT auth.uid()');

  if unwrapped is not null then
    raise exception 'Policies still re-evaluate auth.uid() per row: %', unwrapped;
  end if;
end $$;
