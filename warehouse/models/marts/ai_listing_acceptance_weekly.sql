-- Snap-to-list: drafts the model produced vs drafts sellers accepted.
--
-- KNOWN GAP: `listing_ai_accepted` is allowed in analytics_events but nothing
-- records it yet — accepting a draft happens on the device with no server call
-- (see migration 202609250241). Until a hook exists, accepted_drafts is 0 and
-- acceptance_rate is 0; the model is here so the metric has a home and its
-- definition is fixed before the data arrives.
with drafts as (
  select week_start, count(*) as drafted
  from {{ ref('stg_ai_runs') }}
  where purpose = 'listing_draft' and outcome = 'ok'
  group by week_start
),
accepted as (
  select week_start, count(*) as accepted
  from {{ ref('stg_analytics_events') }}
  where event_type = 'listing_ai_accepted'
  group by week_start
),
weeks as (
  select distinct week_start
  from (
    select week_start from drafts
    union all
    select week_start from accepted
  ) keyed
)
select
  w.week_start,
  coalesce(d.drafted, 0) as drafts_generated,
  coalesce(a.accepted, 0) as drafts_accepted,
  cast(coalesce(a.accepted, 0) as numeric) / nullif(d.drafted, 0) as acceptance_rate
from weeks w
left join drafts d on d.week_start = w.week_start
left join accepted a on a.week_start = w.week_start
