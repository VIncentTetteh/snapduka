-- Growth messaging: the seller's daily digest, and SMS as a broadcast channel.
--
-- `notification_preferences.digest_frequency` has existed since the start
-- (default 'daily') and nothing ever read it. This makes it real: a worker
-- sends each seller a short morning summary — yesterday's orders and paid
-- sales, what is waiting to be fulfilled, unread WhatsApp chats — by WhatsApp
-- template, falling back to SMS. Weekly sellers get it on Mondays covering the
-- last seven days. 'instant' means per-event notifications, which already
-- exist, so it gets no digest; 'off' gets nothing.
--
-- `seller_digests` is the idempotency record: one row per (seller, period,
-- frequency), written whether the digest was sent, skipped (nothing to say) or
-- failed, so a re-run of the worker — or pg_cron firing twice — never sends a
-- second copy, and support can answer "why didn't I get my digest?".

create table public.seller_digests (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  period_start date not null,
  frequency text not null,
  channel text,
  status text not null,
  detail text,
  created_at timestamptz not null default now(),
  constraint seller_digests_period_key unique (seller_account_id, period_start, frequency),
  constraint seller_digests_frequency_check check (frequency in ('daily', 'weekly')),
  constraint seller_digests_channel_check check (channel is null or channel in ('whatsapp', 'sms')),
  constraint seller_digests_status_check check (status in ('sent', 'skipped', 'failed')),
  constraint seller_digests_detail_check check (detail is null or length(detail) <= 300)
);

comment on table public.seller_digests is
  'One row per seller digest period: sent, skipped (nothing to report) or failed. Makes the digest worker idempotent. Service-role only.';

alter table public.seller_digests enable row level security;
alter table public.seller_digests force row level security;
revoke all on public.seller_digests from anon, authenticated;

-- Sellers owed a digest for this period, keyset-paged by id. Bounded per call
-- (the worker loops) because an unbounded read is silently capped at
-- db.max_rows = 1000 — the 1,001st seller would simply never get one.
-- A seller with no preferences row gets the column default, 'daily'.
create or replace function public.seller_digest_due(
  p_frequency text,
  p_period_start date,
  p_after uuid default null,
  p_limit integer default 100
)
returns table (
  seller_account_id uuid,
  contact_phone text,
  shop_name text,
  currency public.currency_code
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.contact_phone, s.display_name, s.currency
    from public.seller_accounts a
    join public.shops s on s.seller_account_id = a.id
    left join public.notification_preferences p on p.seller_account_id = a.id
   where coalesce(p.digest_frequency, 'daily') = p_frequency
     and a.status in ('pending', 'active')
     and a.contact_phone is not null
     and (p_after is null or a.id > p_after)
     and not exists (
       select 1 from public.seller_digests d
        where d.seller_account_id = a.id
          and d.period_start = p_period_start
          and d.frequency = p_frequency
     )
   order by a.id
   limit least(greatest(p_limit, 1), 500);
$$;

-- What the digest says, aggregated in SQL (never by counting rows in JS).
-- Revenue counts paid and partially refunded orders, matching every other
-- revenue figure in the product.
create or replace function public.seller_digest_summary(
  p_seller_account_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  orders_count integer,
  paid_revenue_minor bigint,
  to_fulfil integer,
  unread_conversations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.orders o
      where o.seller_account_id = p_seller_account_id
        and o.created_at >= p_from and o.created_at < p_to
        and o.status <> 'cancelled'),
    (select coalesce(sum(o.total_minor), 0)::bigint from public.orders o
      where o.seller_account_id = p_seller_account_id
        and o.created_at >= p_from and o.created_at < p_to
        and o.payment_status in ('paid', 'partially_refunded')),
    (select count(*)::integer from public.orders o
      where o.seller_account_id = p_seller_account_id
        and o.status in ('confirmed', 'processing')
        and o.fulfillment_status in ('unconfirmed', 'confirmed', 'preparing', 'ready_for_pickup')),
    (select count(*)::integer from public.wa_conversations c
      where c.seller_account_id = p_seller_account_id
        and c.unread_count > 0);
$$;

revoke all on function public.seller_digest_due(text, date, uuid, integer) from public, anon, authenticated;
revoke all on function public.seller_digest_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.seller_digest_due(text, date, uuid, integer) to service_role;
grant execute on function public.seller_digest_summary(uuid, timestamptz, timestamptz) to service_role;

-- The digest template (seller audience, English; draft until Meta approves).
insert into public.wa_templates (name, language, category, audience, body, parameters)
values (
  'seller_digest', 'en', 'utility', 'seller',
  'SnapDuka summary for {{1}} ({{2}}): {{3}} new orders, {{4}} in paid sales. {{5}} to fulfil and {{6}} unread chats. Open your dashboard: {{7}}',
  array['shop_name', 'period', 'orders', 'revenue', 'to_fulfil', 'unread', 'dashboard_url']
)
on conflict (name, language) do nothing;

-- SMS joins email, WhatsApp and push as a broadcast channel. Same consent
-- (`marketing`) and frequency-cap rules as the others; gated by the
-- sms_broadcasts flag in the worker.
alter table public.marketing_broadcasts drop constraint marketing_broadcasts_channel_check;
alter table public.marketing_broadcasts add constraint marketing_broadcasts_channel_check
  check (channel = any (array['email'::text, 'whatsapp'::text, 'push'::text, 'sms'::text]));

-- 07:00 UTC is 07:00 in Accra and 08:00 in Lagos: before the day's orders,
-- after the night's.
select cron.schedule(
  'snapduka-seller-digest',
  '0 7 * * *',
  $$select public.run_internal_job('/api/internal/whatsapp/digest')$$
);
