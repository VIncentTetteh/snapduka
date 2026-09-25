-- Conversations bound to a seller; an unbound one has no shop to convert into.
select
  conversation_key,
  seller_key,
  buyer_phone_key,
  created_at,
  cast({{ dbt.date_trunc("week", "created_at") }} as date) as week_start
from {{ source('snapduka', 'wa_conversations') }}
where seller_key is not null
