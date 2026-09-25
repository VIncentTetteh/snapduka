-- Take rate: what SnapDuka keeps, over GMV. Revenue comes from the ledger (the
-- three revenue accounts, credited when earned), not recomputed from fee
-- rates, so refunds, reversals and write-offs that debit revenue are included.
-- Revenue is dated when posted and GMV when ordered; over a week the two are
-- close, and the ledger is the book of record for the numerator.
with gmv as (
  select week_start, currency, sum(total_minor) as gmv_minor
  from {{ ref('stg_orders') }}
  where is_paid = 1
  group by week_start, currency
),
revenue as (
  select
    week_start,
    currency,
    sum(case when account_kind = 'platform_revenue' then revenue_minor else 0 end) as platform_revenue_minor,
    sum(case when account_kind = 'protect_fee_revenue' then revenue_minor else 0 end) as protect_fee_revenue_minor,
    sum(case when account_kind = 'payout_fee_revenue' then revenue_minor else 0 end) as payout_fee_revenue_minor
  from {{ ref('stg_ledger_entries') }}
  where account_kind in ('platform_revenue', 'protect_fee_revenue', 'payout_fee_revenue')
  group by week_start, currency
),
-- DISTINCT over UNION ALL rather than bare UNION: BigQuery and ClickHouse
-- reject a UNION without ALL/DISTINCT, and not every engine accepts DISTINCT.
weeks as (
  select distinct week_start, currency
  from (
    select week_start, currency from gmv
    union all
    select week_start, currency from revenue
  ) keyed
)
select
  w.week_start,
  w.currency,
  coalesce(g.gmv_minor, 0) as gmv_minor,
  coalesce(r.platform_revenue_minor, 0) as platform_revenue_minor,
  coalesce(r.protect_fee_revenue_minor, 0) as protect_fee_revenue_minor,
  coalesce(r.payout_fee_revenue_minor, 0) as payout_fee_revenue_minor,
  coalesce(r.platform_revenue_minor, 0)
    + coalesce(r.protect_fee_revenue_minor, 0)
    + coalesce(r.payout_fee_revenue_minor, 0) as total_revenue_minor,
  cast(
    coalesce(r.platform_revenue_minor, 0)
    + coalesce(r.protect_fee_revenue_minor, 0)
    + coalesce(r.payout_fee_revenue_minor, 0) as numeric
  ) / nullif(g.gmv_minor, 0) as take_rate
from weeks w
left join gmv g on g.week_start = w.week_start and g.currency = w.currency
left join revenue r on r.week_start = w.week_start and r.currency = w.currency
