-- Stock financing and promoted listings are service-role only: no table is
-- readable or writable by a browser session, and no function in either product
-- is executable by one. Sellers reach them through server routes that resolve
-- and authorise the seller first.

begin;

set local search_path = extensions, public;

select plan(6);

select is(
  (select count(*)::int
     from unnest(array['financing_policies', 'financing_offers', 'financing_advances', 'financing_sweeps',
                       'ad_policies', 'ad_campaigns', 'ad_campaign_products', 'ad_clicks']) t
     cross join unnest(array['anon', 'authenticated']) r
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(r, 'public.' || t, p)),
  0, 'no browser role holds any privilege on the product tables');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('financing_policies', 'financing_offers', 'financing_advances', 'financing_sweeps',
                        'ad_policies', 'ad_campaigns', 'ad_campaign_products', 'ad_clicks')
      and c.relrowsecurity and c.relforcerowsecurity),
  8, 'every product table has forced RLS');

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated']) r
    where n.nspname = 'public'
      and p.proname in ('financing_eligibility', 'create_financing_offer', 'accept_financing_offer',
                        'record_financing_disbursement', 'cancel_financing_advance', 'sweep_financing_repayments',
                        'remit_financing_payables', 'record_partner_settlement', 'close_financing_advance',
                        'financing_partner_amounts_due', 'ads_prepaid_balance', 'ad_campaign_spend_today', 'refresh_ad_campaign_funding',
                        'ads_top_up', 'ads_withdraw', 'validate_ad_campaign_terms', 'create_ad_campaign',
                        'update_ad_campaign', 'sponsored_listings', 'record_ad_click',
                        'check_financial_product_invariants', 'guard_financial_product_balances', 'seller_ad_campaign_stats', 'lock_seller_ad_campaigns',
                        'ad_campaign_products_tenant_check', 'prevent_ad_click_mutation')
      and has_function_privilege(r, p.oid, 'EXECUTE')),
  0, 'no browser role can execute any financing or ads function');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('financing_eligibility', 'create_financing_offer', 'accept_financing_offer',
                        'record_financing_disbursement', 'sweep_financing_repayments', 'remit_financing_payables',
                        'record_partner_settlement', 'ads_top_up', 'ads_withdraw', 'create_ad_campaign',
                        'update_ad_campaign', 'sponsored_listings', 'record_ad_click')
      and not exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=""')),
  0, 'every security definer function pins an empty search_path');

select is(
  (select count(*)::int from pg_constraint
    where conname = 'ledger_accounts_owner_check'
      and pg_get_constraintdef(oid) ~ 'financing_payable'
      and pg_get_constraintdef(oid) ~ 'ads_prepaid'
      and pg_get_constraintdef(oid) ~ 'seller_dispute_reserve'),
  1, 'the new seller-owned kinds joined the owner check without dropping existing ones');

select is((select count(*)::int from cron.job where jobname like 'snapduka-financing-%'), 2,
  'two financing jobs are scheduled');

select * from finish();
rollback;
