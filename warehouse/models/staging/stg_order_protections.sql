select
  order_key,
  seller_key,
  state,
  confirmation_method,
  delivery_confirmed_at,
  disputed_at,
  released_at,
  cast({{ dbt.date_trunc("week", "delivery_confirmed_at") }} as date) as confirmed_week_start
from {{ source('snapduka', 'order_protections') }}
