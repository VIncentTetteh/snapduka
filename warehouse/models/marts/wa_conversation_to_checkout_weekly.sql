-- WhatsApp conversation-to-checkout: of the conversations bound to a shop in a
-- week, how many led to an order from the SAME buyer at the SAME shop within
-- 7 days. Buyer identity is the keyed phone hash on both sides
-- (wa_conversations.buyer_phone_key = orders.buyer_phone_key), so the match is
-- made without either side's phone number ever reaching the warehouse.
--
-- "Checkout" means an order was placed (checkout_completed), paid or not;
-- paid_conversions narrows it to paid orders.
with conversions as (
  select
    c.conversation_key,
    max(case when o.order_key is not null then 1 else 0 end) as converted,
    max(case when o.is_paid = 1 then 1 else 0 end) as converted_paid
  from {{ ref('stg_wa_conversations') }} c
  left join {{ ref('stg_orders') }} o
    on o.seller_key = c.seller_key
   and o.buyer_phone_key = c.buyer_phone_key
   and o.created_at >= c.created_at
   and o.created_at < {{ dbt.dateadd("day", 7, "c.created_at") }}
  group by c.conversation_key
)
select
  c.week_start,
  count(*) as conversations_started,
  sum(v.converted) as checkouts,
  sum(v.converted_paid) as paid_checkouts,
  cast(sum(v.converted) as numeric) / nullif(count(*), 0) as conversation_to_checkout_rate
from {{ ref('stg_wa_conversations') }} c
join conversions v on v.conversation_key = c.conversation_key
group by c.week_start
