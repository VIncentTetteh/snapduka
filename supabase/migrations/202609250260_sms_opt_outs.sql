-- SMS opt-out: the precondition for ever switching on `sms_broadcasts`.
--
-- Every marketing SMS goes out from ONE shared sender ID (TECHIESZON_SMS_SENDER_ID),
-- whichever seller is broadcasting. A buyer who replies STOP is therefore
-- replying to SnapDuka, not to a shop: the reply carries no seller, and there
-- is no honest way to guess which of the shops that texted them they meant.
-- So a STOP is platform-wide — the number is suppressed for every seller's
-- marketing SMS — which is also what the buyer reasonably expects from a sender
-- they cannot tell apart.
--
-- Two records move together on a STOP:
--   * `sms_opt_outs`, keyed by E.164 phone. This is the gate the marketing
--     worker checks before every SMS, for every seller.
--   * each seller's `customer_consents` marketing row for that phone, flipped
--     to 'withdrawn' (the enum's name for a revoked consent). The seller's
--     customer list then shows the truth instead of a consent the buyer has
--     taken back, and it keeps a later WhatsApp/email broadcast from treating a
--     buyer who said "stop texting me" as an enthusiastic subscriber.
--
-- START reverses only the first. Re-subscribing to the shared sender does not
-- re-grant marketing consent to every shop that ever held it: consent to a
-- specific seller is given at that seller's checkout, and a keyword to a
-- shared number is not that. A buyer who sends START and later ticks the box
-- at a shop's checkout is opted back in for that shop the normal way.
--
-- Transactional SMS (order updates, OTP, delivery codes) never read this
-- table. Suppressing an OTP or a delivery code because someone once replied
-- STOP to a promotion would lock them out of their account or their parcel,
-- and those messages are not marketing under any regime we operate in.
--
-- Inbound keywords arrive at /api/sms/inbound/[provider]. `sms_inbound_events`
-- dedupes provider redeliveries by message id and is the record support uses to
-- answer "I replied STOP and still got a text". It stores the matched keyword,
-- never the message body: a free-text reply is the buyer's words, not ours to
-- keep.

create table public.sms_opt_outs (
  phone text primary key,
  opted_out boolean not null default true,
  source text not null,
  keyword text,
  provider text,
  opted_out_at timestamptz,
  opted_in_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_opt_outs_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint sms_opt_outs_source_check check (source in ('inbound_sms', 'operator')),
  constraint sms_opt_outs_keyword_check check (keyword is null or keyword ~ '^[A-Z]{2,12}$'),
  constraint sms_opt_outs_provider_check check (provider is null or provider ~ '^[a-z0-9_-]{1,40}$'),
  constraint sms_opt_outs_state_check check (
    (opted_out and opted_out_at is not null) or (not opted_out and opted_in_at is not null)
  )
);

comment on table public.sms_opt_outs is
  'Platform-wide SMS marketing suppression, keyed by E.164 phone. Checked before every marketing SMS for every seller; never consulted for transactional SMS. Service-role only.';

-- The worker asks "which of these numbers are suppressed?" in batches.
create index sms_opt_outs_opted_out_idx on public.sms_opt_outs (phone) where opted_out;

alter table public.sms_opt_outs enable row level security;
alter table public.sms_opt_outs force row level security;
revoke all on public.sms_opt_outs from anon, authenticated;
grant select, insert, update, delete on public.sms_opt_outs to service_role;

create table public.sms_inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_message_id text,
  phone text not null,
  keyword text,
  action text not null,
  received_at timestamptz not null default now(),
  constraint sms_inbound_events_provider_check check (provider ~ '^[a-z0-9_-]{1,40}$'),
  constraint sms_inbound_events_message_id_check check (
    provider_message_id is null or length(provider_message_id) between 1 and 200
  ),
  constraint sms_inbound_events_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint sms_inbound_events_action_check check (action in ('opt_out', 'opt_in', 'ignored')),
  constraint sms_inbound_events_keyword_check check (keyword is null or keyword ~ '^[A-Z]{2,12}$')
);

-- Partial: a provider that sends no message id cannot be deduped, and must not
-- collide with every other id-less event.
create unique index sms_inbound_events_provider_message_key
  on public.sms_inbound_events (provider, provider_message_id)
  where provider_message_id is not null;
create index sms_inbound_events_phone_idx on public.sms_inbound_events (phone, received_at desc);

comment on table public.sms_inbound_events is
  'Inbound SMS keywords (STOP/START...) as received, deduped by provider message id. Keyword only, never the message body. Service-role only.';

alter table public.sms_inbound_events enable row level security;
alter table public.sms_inbound_events force row level security;
revoke all on public.sms_inbound_events from anon, authenticated;
grant select, insert on public.sms_inbound_events to service_role;

-- ── Applying a keyword ──────────────────────────────────────────────────────
-- One function for the inbound webhook and the operator action, so the two
-- cannot drift on what an opt-out does. The dedupe insert and the state change
-- share a transaction: a redelivered STOP finds its event row and changes
-- nothing, and a crash between the two cannot leave an event recorded but not
-- applied.
create or replace function public.sms_apply_opt_keyword(
  p_phone text,
  p_action text,
  p_source text,
  p_keyword text default null,
  p_provider text default null,
  p_provider_message_id text default null,
  p_actor uuid default null
)
returns table (duplicate boolean, opted_out boolean, consents_withdrawn integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_withdrawn integer := 0;
  v_state boolean;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'sms_apply_opt_keyword: phone must be E.164';
  end if;
  if p_action not in ('opt_out', 'opt_in', 'ignored') then
    raise exception using errcode = '22023', message = 'sms_apply_opt_keyword: unknown action';
  end if;

  if p_source = 'inbound_sms' then
    insert into public.sms_inbound_events (provider, provider_message_id, phone, keyword, action)
    values (coalesce(p_provider, 'unknown'), p_provider_message_id, p_phone, p_keyword, p_action)
    on conflict (provider, provider_message_id) where provider_message_id is not null do nothing
    returning id into v_event_id;

    if v_event_id is null then
      select o.opted_out into v_state from public.sms_opt_outs o where o.phone = p_phone;
      return query select true, coalesce(v_state, false), 0;
      return;
    end if;
  end if;

  if p_action = 'opt_out' then
    insert into public.sms_opt_outs as o (phone, opted_out, source, keyword, provider, opted_out_at, created_by)
    values (p_phone, true, p_source, p_keyword, p_provider, now(), p_actor)
    on conflict (phone) do update
      set opted_out = true,
          source = excluded.source,
          keyword = excluded.keyword,
          provider = excluded.provider,
          opted_out_at = now(),
          created_by = excluded.created_by,
          updated_at = now();

    -- Every seller's record of this buyer's marketing consent. customers.phone
    -- is E.164-checked, so an exact match is the whole match.
    with withdrawn as (
      update public.customer_consents cc
         set status = 'withdrawn',
             captured_at = now(),
             source = 'sms_stop'
        from public.customers c
       where c.id = cc.customer_id
         and c.phone = p_phone
         and cc.purpose = 'marketing'
         and cc.status <> 'withdrawn'
      returning cc.id
    )
    select count(*)::integer into v_withdrawn from withdrawn;
    v_state := true;
  elsif p_action = 'opt_in' then
    update public.sms_opt_outs o
       set opted_out = false,
           source = p_source,
           keyword = p_keyword,
           provider = p_provider,
           opted_in_at = now(),
           updated_at = now()
     where o.phone = p_phone;
    v_state := false;
  else
    select o.opted_out into v_state from public.sms_opt_outs o where o.phone = p_phone;
  end if;

  return query select false, coalesce(v_state, false), v_withdrawn;
end;
$$;

comment on function public.sms_apply_opt_keyword(text, text, text, text, text, text, uuid) is
  'Applies an SMS STOP/START (inbound keyword or operator action): platform-wide suppression plus withdrawal of every seller''s marketing consent for the phone. Deduped by provider message id. service_role only.';

-- Which of a batch of phones must not receive marketing SMS. Bounded by the
-- caller's batch (the worker sends <= 500 at a time), so it never meets
-- db.max_rows.
create or replace function public.sms_suppressed_phones(p_phones text[])
returns table (phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.phone
    from public.sms_opt_outs o
   where o.opted_out
     and o.phone = any (p_phones);
$$;

-- The seller-facing number on the broadcast page: how many of this seller's
-- customers an SMS broadcast will skip. A count, never the phones: which of
-- your buyers texted STOP to a shared number is not the seller's to know.
create or replace function public.seller_sms_suppressed_count(p_seller_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.customers c
    join public.sms_opt_outs o on o.phone = c.phone and o.opted_out
   where c.seller_account_id = p_seller_account_id;
$$;

revoke all on function public.sms_apply_opt_keyword(text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.sms_suppressed_phones(text[]) from public, anon, authenticated;
revoke all on function public.seller_sms_suppressed_count(uuid) from public, anon, authenticated;
grant execute on function public.sms_apply_opt_keyword(text, text, text, text, text, text, uuid) to service_role;
grant execute on function public.sms_suppressed_phones(text[]) to service_role;
grant execute on function public.seller_sms_suppressed_count(uuid) to service_role;
