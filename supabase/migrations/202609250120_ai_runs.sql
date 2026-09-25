-- AI foundation: one row per model call, and a price suggestion that does not
-- come from the model.
--
-- Every LLM call SnapDuka makes (Snap-to-list drafts, the WhatsApp classifier
-- and agent turns, caption suggestions) costs real money per seller, and the
-- roadmap commits to a per-seller budget. A budget can only be enforced against
-- a record of what was spent, so `ai_runs` is written for every call — success,
-- failure, invalid output and budget refusals alike. Cost is computed in code
-- from a pricing constant at write time (src/lib/ai/models.ts) and stored, so a
-- later price change does not silently rewrite last month's spend.
--
-- Service-role only. Sellers never read this table directly; any spend they see
-- comes through a server route.

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: a call that is not on a seller's behalf (the eval harness, an
  -- unbound WhatsApp conversation) still has to be accounted for somewhere.
  seller_account_id uuid references public.seller_accounts (id) on delete cascade,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  -- Micro-USD (1e-6 dollars): integer, so summing a month of runs never meets
  -- floating-point drift.
  cost_usd_micros bigint not null default 0,
  latency_ms integer not null default 0,
  outcome text not null,
  error text,
  -- Free-form correlation (conversation id, storage path). Never the prompt or
  -- the buyer's words: this table outlives the conversation it describes.
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_runs_purpose_check check (purpose ~ '^[a-z][a-z0-9_.]{1,63}$'),
  constraint ai_runs_outcome_check check (
    outcome in ('ok', 'error', 'invalid_output', 'refused', 'budget_exceeded', 'max_tokens')
  ),
  constraint ai_runs_tokens_check check (
    input_tokens >= 0 and output_tokens >= 0 and cache_read_tokens >= 0 and cache_write_tokens >= 0
  ),
  constraint ai_runs_cost_check check (cost_usd_micros >= 0),
  constraint ai_runs_latency_check check (latency_ms >= 0),
  constraint ai_runs_error_length_check check (error is null or length(error) <= 1000)
);

comment on table public.ai_runs is
  'One row per LLM call: tokens, cost (micro-USD, priced at write time), latency, outcome. Service-role only.';

create index ai_runs_seller_created on public.ai_runs (seller_account_id, created_at desc)
  where seller_account_id is not null;
create index ai_runs_purpose_created on public.ai_runs (purpose, created_at desc);

alter table public.ai_runs enable row level security;
alter table public.ai_runs force row level security;
revoke all on public.ai_runs from anon, authenticated;

-- Spend since the start of the current UTC month. Aggregated in SQL rather than
-- summed in JS: an unbounded select is capped at db.max_rows (1000) with no
-- error, which would make a heavy user's budget look *smaller* the more they
-- used — exactly backwards.
create or replace function public.ai_spend_this_month(p_seller_account_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.cost_usd_micros), 0)::bigint
    from public.ai_runs r
   where r.seller_account_id = p_seller_account_id
     and r.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

revoke all on function public.ai_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function public.ai_spend_this_month(uuid) to service_role;

-- Price guidance for Snap-to-list. The model never proposes a price: a vision
-- model guessing what shea butter costs in Kumasi is a hallucination with a
-- currency sign on it. This answers from what active products in the same
-- category and country are actually listed at.
--
-- Bounded twice: at most the 2,000 most recently published products are
-- sampled (the percentiles barely move past that, and the query stays cheap for
-- a category with 100k listings), and fewer than 5 products returns the sample
-- size with null percentiles so the caller can say "not enough data" instead of
-- presenting two listings as a market.
--
-- Security definer because it reads every seller's prices — but only ever
-- returns aggregates, and only to the service role.
create or replace function public.suggest_price(
  p_category_id uuid,
  p_country public.country_code
)
returns table (
  currency public.currency_code,
  sample_size integer,
  p25_minor bigint,
  median_minor bigint,
  p75_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with sample as (
    select p.currency, p.price_minor
      from public.product_categories pc
      join public.products p on p.id = pc.product_id
      join public.shops s on s.id = p.shop_id
     where pc.category_id = p_category_id
       and s.country = p_country
       and s.status = 'published'
       and p.status = 'active'
       and p.moderation_status <> 'hidden'
       and p.price_minor > 0
     order by p.published_at desc nulls last
     limit 2000
  )
  select s.currency,
         count(*)::integer,
         case when count(*) >= 5
              then (percentile_cont(0.25) within group (order by s.price_minor))::bigint end,
         case when count(*) >= 5
              then (percentile_cont(0.5) within group (order by s.price_minor))::bigint end,
         case when count(*) >= 5
              then (percentile_cont(0.75) within group (order by s.price_minor))::bigint end
    from sample s
   group by s.currency
   order by count(*) desc;
$$;

revoke all on function public.suggest_price(uuid, public.country_code) from public, anon, authenticated;
grant execute on function public.suggest_price(uuid, public.country_code) to service_role;
