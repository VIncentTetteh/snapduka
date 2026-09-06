-- The permission matrix and RLS have to agree, and a suspended account must not
-- be operable by its team.
--
-- Two properties, both verified against production before 202609060090 closed
-- them:
--
--   * A `manager` on a SUSPENDED account inserted a product successfully.
--     202609050089 guarded the owner policies; team policies are separate and
--     OR'd alongside them, so suspending an account stopped the owner and left
--     their staff working. current_seller_status() cannot express this — it
--     resolves through auth.uid(), which is NULL for a pure team member — so
--     seller_account_operable() asks about the account instead of the caller.
--
--   * The matrix grants `manager` campaigns.manage and settings.manage, and the
--     server actions check exactly those and proceed, but no team policy
--     existed on any of the tables behind them. The permission existed, the
--     screen was reachable, and the database refused the write.

begin;

set local search_path = extensions, public;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
 ('0dd00000-0000-4000-8000-000000000201','00000000-0000-0000-0000-000000000000','authenticated','authenticated','act-owner@team.test',now(),now()),
 ('0dd00000-0000-4000-8000-000000000202','00000000-0000-0000-0000-000000000000','authenticated','authenticated','act-manager@team.test',now(),now()),
 ('0dd00000-0000-4000-8000-000000000203','00000000-0000-0000-0000-000000000000','authenticated','authenticated','act-fulfil@team.test',now(),now()),
 ('0dd00000-0000-4000-8000-000000000204','00000000-0000-0000-0000-000000000000','authenticated','authenticated','susp-owner@team.test',now(),now()),
 ('0dd00000-0000-4000-8000-000000000205','00000000-0000-0000-0000-000000000000','authenticated','authenticated','susp-manager@team.test',now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name) values
 ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000201','GH','active',true,'Active Owner'),
 ('0dd00000-0000-4000-8000-000000000211','0dd00000-0000-4000-8000-000000000204','GH','suspended',false,'Suspended Owner');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status) values
 ('0dd00000-0000-4000-8000-000000000220','0dd00000-0000-4000-8000-000000000210','active-team-shop','Active','GH','GHS','draft'),
 ('0dd00000-0000-4000-8000-000000000221','0dd00000-0000-4000-8000-000000000211','susp-team-shop','Suspended','GH','GHS','draft');

insert into public.team_memberships (seller_account_id, auth_user_id, email, role, active) values
 ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000202','act-manager@team.test','manager',true),
 ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000203','act-fulfil@team.test','fulfillment',true),
 ('0dd00000-0000-4000-8000-000000000211','0dd00000-0000-4000-8000-000000000205','susp-manager@team.test','manager',true);

-- ── Suspension is not bypassable through staff ─────────────────────────────
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000205","role":"authenticated"}';
     insert into public.products (seller_account_id, shop_id, name, slug, status, price_minor, currency, stock_quantity)
     values ('0dd00000-0000-4000-8000-000000000211','0dd00000-0000-4000-8000-000000000221','Bypass','bypass-p','draft',1000,'GHS',5) $$,
  '42501',
  NULL,
  'a manager cannot keep operating a suspended account'
);

-- ── A manager gets what the matrix promises ────────────────────────────────
select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000202","role":"authenticated"}';
     insert into public.campaigns (seller_account_id, shop_id, name, status)
     values ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000220','Manager campaign','draft') $$,
  'campaigns.manage lets a manager create a campaign'
);

select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000202","role":"authenticated"}';
     insert into public.promotions (seller_account_id, shop_id, name, code, kind, value, active)
     values ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000220','Mgr','MGR10',
             (enum_range(null::public.discount_kind))[1],10,true) $$,
  'campaigns.manage lets a manager create a discount code'
);

select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000202","role":"authenticated"}';
     insert into public.customer_segments (seller_account_id, name, rules)
     values ('0dd00000-0000-4000-8000-000000000210','Manager segment','{}'::jsonb) $$,
  'campaigns.manage lets a manager define a customer group'
);

select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000202","role":"authenticated"}';
     insert into public.discovery_preferences (seller_account_id, shop_id, opted_in)
     values ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000220',true) $$,
  'settings.manage lets a manager change shop settings'
);

-- ── And nothing more than the matrix promises ──────────────────────────────
-- `fulfillment` holds orders.manage only. Widening a team policy past the
-- permission it mirrors would be a privilege escalation, so it is asserted
-- rather than assumed.
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000203","role":"authenticated"}';
     insert into public.promotions (seller_account_id, shop_id, name, code, kind, value, active)
     values ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000220','Ful','FUL10',
             (enum_range(null::public.discount_kind))[1],10,true) $$,
  '42501',
  NULL,
  'a fulfillment member cannot create a discount code'
);

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"0dd00000-0000-4000-8000-000000000203","role":"authenticated"}';
     insert into public.campaigns (seller_account_id, shop_id, name, status)
     values ('0dd00000-0000-4000-8000-000000000210','0dd00000-0000-4000-8000-000000000220','Ful campaign','draft') $$,
  '42501',
  NULL,
  'a fulfillment member cannot create a campaign'
);

-- ── The property, so a future team policy cannot reopen the bypass ─────────
select is_empty(
  $$ select tablename || '.' || policyname
     from pg_policies
     where schemaname = 'public'
       and cmd in ('ALL','INSERT','UPDATE','DELETE')
       and (coalesce(qual,'') || coalesce(with_check,'')) like '%team_has_role%'
       and (coalesce(qual,'') || coalesce(with_check,'')) not like '%seller_account_operable%' $$,
  'every team write policy checks the account is still operable'
);

select * from finish();
rollback;
