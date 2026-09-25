-- Only the reasons that make a case a Protect dispute when the order is
-- protected and unreleased (see 202609250108 open_protect_dispute_from_case).
select
  case_key,
  order_key,
  seller_key,
  reason,
  status,
  created_at,
  case
    when reason in ('item_not_received', 'item_not_as_described', 'refund_request') then 1
    else 0
  end as is_dispute_reason
from {{ source('snapduka', 'support_cases') }}
