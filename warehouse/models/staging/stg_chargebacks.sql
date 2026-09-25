select
  chargeback_key,
  order_key,
  seller_key,
  provider,
  currency,
  amount_minor,
  status,
  created_at
from {{ source('snapduka', 'chargebacks') }}
