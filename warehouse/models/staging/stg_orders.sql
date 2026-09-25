-- One row per order. "Transacting" and GMV count paid and partially refunded
-- orders, matching admin_north_star (202609250112): a partial refund does not
-- undo the fact that the order went through SnapDuka.
select
  order_key,
  seller_key,
  shop_key,
  customer_key,
  buyer_phone_key,
  currency,
  payment_status,
  protection_mode,
  total_minor,
  protect_fee_minor,
  created_at,
  cast({{ dbt.date_trunc("week", "created_at") }} as date) as week_start,
  case when payment_status in ('paid', 'partially_refunded') then 1 else 0 end as is_paid,
  case when protection_mode = 'protect' then 1 else 0 end as is_protected
from {{ source('snapduka', 'orders') }}
