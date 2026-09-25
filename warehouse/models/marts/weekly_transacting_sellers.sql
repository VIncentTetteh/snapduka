-- North star #1: sellers with at least one paid order in the week, per
-- currency. Same definition as admin_north_star (202609250112), so the admin
-- overview and the warehouse agree.
select
  week_start,
  currency,
  count(distinct seller_key) as transacting_sellers,
  count(*) as paid_orders,
  sum(total_minor) as gmv_minor
from {{ ref('stg_orders') }}
where is_paid = 1
group by week_start, currency
