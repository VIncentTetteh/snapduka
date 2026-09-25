-- How Protect deliveries were confirmed, by week of confirmation. The delivery
-- code is the trust mechanism; a low code rate means deliveries are being
-- released by timeout ('auto') or by an operator instead of by the buyer.
select
  confirmed_week_start as week_start,
  count(*) as confirmed_deliveries,
  sum(case when confirmation_method in ('buyer_code', 'rider_code') then 1 else 0 end) as code_confirmations,
  sum(case when confirmation_method = 'buyer_tap' then 1 else 0 end) as buyer_tap_confirmations,
  sum(case when confirmation_method = 'auto' then 1 else 0 end) as auto_confirmations,
  sum(case when confirmation_method = 'operator' then 1 else 0 end) as operator_confirmations,
  cast(sum(case when confirmation_method in ('buyer_code', 'rider_code') then 1 else 0 end) as numeric)
    / nullif(count(*), 0) as code_confirmation_rate
from {{ ref('stg_order_protections') }}
where delivery_confirmed_at is not null
group by confirmed_week_start
