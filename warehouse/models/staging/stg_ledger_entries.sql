-- Ledger lines with the account kind. Amounts are debit-positive,
-- credit-negative (as in the primary), so a credit-normal revenue account's
-- revenue is the NEGATED sum of its lines; `revenue_minor` does that once here.
select
  entry_key,
  transaction_key,
  account_kind,
  seller_key,
  currency,
  amount_minor,
  created_at,
  cast({{ dbt.date_trunc("week", "created_at") }} as date) as week_start,
  case
    when account_kind in ('platform_revenue', 'protect_fee_revenue', 'payout_fee_revenue')
      then -amount_minor
    else 0
  end as revenue_minor
from {{ source('snapduka', 'ledger_entries') }}
