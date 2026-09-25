-- Server-side funnel events in analytics_events.
--
-- analytics_events only knew what the storefront browser reports: visit,
-- product_view, checkout_start. The roadmap's funnel continues past the point
-- the browser can be trusted — an order placed, Protect chosen, a delivery
-- confirmed, an instant payout asked for — and those facts belong to the
-- server. A browser that could post `checkout_completed` could inflate any
-- shop's conversion rate, so these types are NOT added to the public ingestion
-- route's allow-list (src/lib/analytics/events.ts keeps the two lists apart).
--
-- Where they are recorded, and why there:
--
--  checkout_completed       AFTER INSERT on orders. create_guest_order is the
--                           only writer of orders, so the insert IS the
--                           checkout route succeeding.
--  protect_opted_in         orders.protection_mode becoming 'protect' (what
--                           set_order_protection does on success), or an order
--                           inserted already protected.
--  payout_instant_requested AFTER INSERT on payout_requests with speed
--                           'instant' (request_seller_payout's success).
--  wa_conversation_started  a wa_conversations row that is (or becomes) bound
--                           to a seller: before that there is no shop to
--                           attribute it to.
--  delivery_confirmed       the protect.delivered outbox handler
--                           (src/lib/analytics/handlers.ts), calling
--                           record_order_analytics_event.
--  listing_ai_accepted      allowed, but not yet recorded: accepting a
--                           Snap-to-list draft happens on the device and no
--                           server call marks it. It needs a seller-authenticated
--                           hook before it can be counted honestly.
--
-- Triggers rather than edits to the money functions: the event is then
-- recorded in the same transaction as the fact whichever code path causes it,
-- and the money functions stay untouched. Each trigger swallows its own
-- failure (with a warning) — analytics must never roll back a checkout or a
-- payout. That makes a broken call look like "nothing happened", so pgTAP 091
-- asserts the rows land (see plpgsql-handlers-hide-resolution-errors).
--
-- Idempotent by construction: the event id is derived from (type, subject), so
-- a retried outbox delivery or a buyer toggling Protect off and on records one
-- event, not several. session_id is the subject (order, payout, conversation):
-- a server event has no browser session, and this keeps the column honest
-- rather than inventing one. Dimensions carry ids and enums only — never a
-- phone, email or name (the table's check constraint enforces the keys).

alter table public.analytics_events drop constraint analytics_event_type_check;
alter table public.analytics_events add constraint analytics_event_type_check check (
  event_type in (
    'visit', 'product_view', 'checkout_start',
    'checkout_completed', 'protect_opted_in', 'delivery_confirmed',
    'listing_ai_accepted', 'wa_conversation_started', 'payout_instant_requested'
  )
);

-- Funnel queries read one type over a time range across the platform.
create index if not exists analytics_type_time_idx on public.analytics_events (event_type, created_at desc);

-- ── The single writer for server events ─────────────────────────────────────
create or replace function public.record_server_analytics_event(
  p_event_type text,
  p_seller_account_id uuid,
  p_subject_id uuid,
  p_shop_id uuid default null,
  p_dimensions jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_id uuid;
  v_shop uuid := p_shop_id;
begin
  if p_event_type not in (
    'checkout_completed', 'protect_opted_in', 'delivery_confirmed',
    'listing_ai_accepted', 'wa_conversation_started', 'payout_instant_requested'
  ) then
    raise exception 'not a server analytics event: %', p_event_type using errcode = '22023';
  end if;
  if p_seller_account_id is null or p_subject_id is null then
    raise exception 'server analytics events need a seller and a subject' using errcode = '22023';
  end if;

  if v_shop is null then
    select s.id into v_shop from public.shops s where s.seller_account_id = p_seller_account_id limit 1;
  end if;
  -- A seller with no shop has no storefront funnel to attribute this to.
  if v_shop is null then
    return null;
  end if;

  v_id := md5(p_event_type || ':' || p_subject_id::text)::uuid;

  insert into public.analytics_events (
    id, seller_account_id, shop_id, session_id, event_type, dimensions, created_at
  ) values (
    v_id, p_seller_account_id, v_shop, p_subject_id, p_event_type,
    coalesce(p_dimensions, '{}'::jsonb) || jsonb_build_object('origin', 'server'),
    coalesce(p_occurred_at, now())
  )
  on conflict (id) do nothing;

  return v_id;
end;
$$;

-- For callers that only hold an order id (the outbox handler).
create or replace function public.record_order_analytics_event(
  p_event_type text,
  p_order_id uuid,
  p_dimensions jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  o record;
begin
  select id, seller_account_id, shop_id into o from public.orders where id = p_order_id;
  if o.id is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;
  return public.record_server_analytics_event(
    p_event_type, o.seller_account_id, o.id, o.shop_id, p_dimensions);
end;
$$;

revoke all on function public.record_server_analytics_event(text, uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.record_order_analytics_event(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_server_analytics_event(text, uuid, uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.record_order_analytics_event(text, uuid, jsonb) to service_role;

-- ── Order triggers: checkout_completed, protect_opted_in ────────────────────
create or replace function public.analytics_on_order_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  begin
    perform public.record_server_analytics_event(
      'checkout_completed', new.seller_account_id, new.id, new.shop_id,
      jsonb_build_object('payment_method', new.payment_method, 'currency', new.currency,
                         'protection_mode', new.protection_mode),
      new.created_at);
    if new.protection_mode = 'protect' then
      perform public.record_server_analytics_event(
        'protect_opted_in', new.seller_account_id, new.id, new.shop_id, '{}'::jsonb, new.created_at);
    end if;
  exception when others then
    raise warning 'analytics_on_order_insert(%): % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.analytics_on_order_protection()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  begin
    perform public.record_server_analytics_event(
      'protect_opted_in', new.seller_account_id, new.id, new.shop_id,
      jsonb_build_object('currency', new.currency));
  exception when others then
    raise warning 'analytics_on_order_protection(%): % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists orders_analytics_checkout_completed on public.orders;
create trigger orders_analytics_checkout_completed
  after insert on public.orders
  for each row execute function public.analytics_on_order_insert();

drop trigger if exists orders_analytics_protect_opted_in on public.orders;
create trigger orders_analytics_protect_opted_in
  after update of protection_mode on public.orders
  for each row
  when (new.protection_mode = 'protect' and old.protection_mode is distinct from 'protect')
  execute function public.analytics_on_order_protection();

-- ── payout_instant_requested ────────────────────────────────────────────────
create or replace function public.analytics_on_instant_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  begin
    perform public.record_server_analytics_event(
      'payout_instant_requested', new.seller_account_id, new.id, null,
      jsonb_build_object('currency', new.currency), new.created_at);
  exception when others then
    raise warning 'analytics_on_instant_payout(%): % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists payout_requests_analytics_instant on public.payout_requests;
create trigger payout_requests_analytics_instant
  after insert on public.payout_requests
  for each row
  when (new.speed = 'instant')
  execute function public.analytics_on_instant_payout();

-- ── wa_conversation_started ─────────────────────────────────────────────────
-- Never the buyer's phone: the subject is the conversation id.
create or replace function public.analytics_on_wa_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  begin
    perform public.record_server_analytics_event(
      'wa_conversation_started', new.seller_account_id, new.id, null, '{}'::jsonb);
  exception when others then
    raise warning 'analytics_on_wa_conversation(%): % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists wa_conversations_analytics_insert on public.wa_conversations;
create trigger wa_conversations_analytics_insert
  after insert on public.wa_conversations
  for each row
  when (new.seller_account_id is not null)
  execute function public.analytics_on_wa_conversation();

drop trigger if exists wa_conversations_analytics_bound on public.wa_conversations;
create trigger wa_conversations_analytics_bound
  after update of seller_account_id on public.wa_conversations
  for each row
  when (new.seller_account_id is not null and old.seller_account_id is null)
  execute function public.analytics_on_wa_conversation();

-- Trigger functions are not callable directly (202609060092).
revoke all on function public.analytics_on_order_insert() from public, anon, authenticated;
revoke all on function public.analytics_on_order_protection() from public, anon, authenticated;
revoke all on function public.analytics_on_instant_payout() from public, anon, authenticated;
revoke all on function public.analytics_on_wa_conversation() from public, anon, authenticated;
