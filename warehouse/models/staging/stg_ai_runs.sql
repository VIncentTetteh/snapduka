select
  run_key,
  seller_key,
  purpose,
  outcome,
  cost_usd_micros,
  created_at,
  cast({{ dbt.date_trunc("week", "created_at") }} as date) as week_start
from {{ source('snapduka', 'ai_runs') }}
