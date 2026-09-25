select
  analytics_event_key,
  seller_key,
  shop_key,
  session_key,
  event_type,
  created_at,
  cast({{ dbt.date_trunc("week", "created_at") }} as date) as week_start
from {{ source('snapduka', 'analytics_events') }}
