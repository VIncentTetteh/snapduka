-- Assertions for scripts/check_models.py --verify. Each mart was snapshotted
-- into pg_temp.before_<mart> before seed.sql ran, so every check is a DELTA
-- for this week's GHS row: the shared local database may hold other data.

create or replace function pg_temp.delta(p_mart text, p_col text, p_where text) returns numeric
language plpgsql as $$
declare after_value numeric; before_value numeric;
begin
  execute format('select coalesce(sum(%I), 0) from dbt_check.%I where %s', p_col, p_mart, p_where) into after_value;
  execute format('select coalesce(sum(%I), 0) from pg_temp.%I where %s', p_col, 'before_' || p_mart, p_where)
    into before_value;
  return after_value - before_value;
end $$;

create or replace function pg_temp.expect(p_mart text, p_col text, p_want numeric, p_currency boolean default true)
returns void language plpgsql as $$
declare
  v_where text := format('week_start = %L', date_trunc('week', now())::date)
                  || case when p_currency then ' and currency = ''GHS''' else '' end;
  v_got numeric := pg_temp.delta(p_mart, p_col, v_where);
begin
  if v_got is distinct from p_want then
    raise exception 'EXPECTATION FAILED %.%: got %, want %', p_mart, p_col, v_got, p_want;
  end if;
  raise notice 'ok %.% = %', p_mart, p_col, v_got;
end $$;

-- GMV: o1 and o2 carry a GH₵1.50 Protect fee.
select pg_temp.expect('weekly_transacting_sellers', 'transacting_sellers', 1);
select pg_temp.expect('weekly_transacting_sellers', 'paid_orders', 3);
select pg_temp.expect('weekly_transacting_sellers', 'gmv_minor', 30300);

select pg_temp.expect('protect_gmv_weekly', 'protect_orders', 2);
select pg_temp.expect('protect_gmv_weekly', 'protect_gmv_minor', 20300);
select pg_temp.expect('protect_gmv_weekly', 'protect_fee_minor', 300);

-- Take rate numerator from the ledger: 7% of each GH₵100.00 of goods, plus the
-- two Protect fees; no payout fees.
select pg_temp.expect('take_rate_weekly', 'gmv_minor', 30300);
select pg_temp.expect('take_rate_weekly', 'platform_revenue_minor', 2100);
select pg_temp.expect('take_rate_weekly', 'protect_fee_revenue_minor', 300);
select pg_temp.expect('take_rate_weekly', 'payout_fee_revenue_minor', 0);
select pg_temp.expect('take_rate_weekly', 'total_revenue_minor', 2400);

select pg_temp.expect('dispute_rates_weekly', 'paid_orders', 3);
select pg_temp.expect('dispute_rates_weekly', 'protect_disputes', 1);
select pg_temp.expect('dispute_rates_weekly', 'buyer_cases', 1);
select pg_temp.expect('dispute_rates_weekly', 'chargebacks', 1);

select pg_temp.expect('delivery_code_confirmation_weekly', 'confirmed_deliveries', 1, false);
select pg_temp.expect('delivery_code_confirmation_weekly', 'code_confirmations', 1, false);

select pg_temp.expect('ai_listing_acceptance_weekly', 'drafts_generated', 4, false);
select pg_temp.expect('ai_listing_acceptance_weekly', 'drafts_accepted', 1, false);

select pg_temp.expect('wa_conversation_to_checkout_weekly', 'conversations_started', 2, false);
select pg_temp.expect('wa_conversation_to_checkout_weekly', 'checkouts', 1, false);
select pg_temp.expect('wa_conversation_to_checkout_weekly', 'paid_checkouts', 1, false);

-- The fixtures moved real money: the ledger must still balance.
do $$
begin
  if exists (select 1 from public.check_ledger_invariants()) then
    raise exception 'EXPECTATION FAILED: ledger invariants broken by the fixtures';
  end if;
end $$;
