-- North star #2: GMV through SnapDuka Protect and its share of all GMV.
select
  week_start,
  currency,
  count(*) as paid_orders,
  sum(total_minor) as gmv_minor,
  sum(is_protected) as protect_orders,
  sum(case when is_protected = 1 then total_minor else 0 end) as protect_gmv_minor,
  sum(protect_fee_minor) as protect_fee_minor,
  cast(sum(case when is_protected = 1 then total_minor else 0 end) as numeric)
    / nullif(sum(total_minor), 0) as protect_gmv_share
from {{ ref('stg_orders') }}
where is_paid = 1
group by week_start, currency
