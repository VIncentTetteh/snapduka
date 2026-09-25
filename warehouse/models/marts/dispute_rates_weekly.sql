-- Dispute and chargeback rates by ORDER week (cohort): a dispute is charged to
-- the week its order was placed, so a rate is never "this week's disputes over
-- this week's orders" when the disputes are about last month's orders.
--
-- protect_dispute_rate: protected paid orders that reached the disputed state,
--   over protected paid orders (order_protections.disputed_at is set by the
--   same trigger that freezes the money).
-- buyer_case_rate: paid orders with a dispute-reason case (item not received,
--   not as described, refund), protected or not, over paid orders.
-- chargeback_rate: paid orders with a processor chargeback, over paid orders.
with paid as (
  select order_key, week_start, currency, is_protected
  from {{ ref('stg_orders') }}
  where is_paid = 1
),
protect_disputed as (
  select distinct order_key from {{ ref('stg_order_protections') }} where disputed_at is not null
),
cased as (
  select distinct order_key from {{ ref('stg_support_cases') }} where is_dispute_reason = 1
),
charged_back as (
  select distinct order_key from {{ ref('stg_chargebacks') }}
)
select
  p.week_start,
  p.currency,
  count(*) as paid_orders,
  sum(p.is_protected) as protect_orders,
  sum(case when pd.order_key is not null and p.is_protected = 1 then 1 else 0 end) as protect_disputes,
  sum(case when c.order_key is not null then 1 else 0 end) as buyer_cases,
  sum(case when cb.order_key is not null then 1 else 0 end) as chargebacks,
  cast(sum(case when pd.order_key is not null and p.is_protected = 1 then 1 else 0 end) as numeric)
    / nullif(sum(p.is_protected), 0) as protect_dispute_rate,
  cast(sum(case when c.order_key is not null then 1 else 0 end) as numeric)
    / nullif(count(*), 0) as buyer_case_rate,
  cast(sum(case when cb.order_key is not null then 1 else 0 end) as numeric)
    / nullif(count(*), 0) as chargeback_rate
from paid p
left join protect_disputed pd on pd.order_key = p.order_key
left join cased c on c.order_key = p.order_key
left join charged_back cb on cb.order_key = p.order_key
group by p.week_start, p.currency
