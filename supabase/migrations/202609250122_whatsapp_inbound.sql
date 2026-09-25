-- WhatsApp inbound: store, route to a shop, hand to the agent — in one
-- transaction.
--
-- The webhook must answer Meta within seconds or Meta retries, and a retry of a
-- message already handled must not reply twice. So the webhook does only this:
-- one call to wa_record_inbound, which
--   1. drops a wamid it has already stored (Meta redelivers freely),
--   2. finds which shop the buyer means,
--   3. stores the message and opens the 24h window,
--   4. emits `whatsapp.inbound` into the outbox in the same transaction,
-- and returns 200. The agent runs from the outbox, where a failure is retried
-- rather than lost.
--
-- Routing on SnapDuka's one shared number:
--   * a message naming a shop — `SHOP-<slug_code>` from the storefront's chat
--     link, or the storefront address itself — binds the conversation to it;
--   * otherwise the buyer is continuing whichever shop they spoke with most
--     recently (30 days), including a shop that just sent them an order update;
--   * otherwise it lands in the phone's unbound conversation and the agent asks
--     which shop they mean. When they name one, the unbound thread moves into
--     that shop's conversation so the seller sees how it started.

create index if not exists shops_slug_code_idx on public.shops (slug_code);

-- Which shop a message names, or null. Tokenised rather than regex-matched
-- against every shop, so the cost is bounded by the message (first 1,000
-- characters, 60 tokens), not by the number of shops. A bare slug only counts
-- when it contains a hyphen (name-plus-code, 202609060101): a one-word legacy
-- slug like "shoes" would otherwise bind every buyer who mentions shoes.
create or replace function public.wa_find_shop_in_text(p_text text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with tokens as (
    select m[1] as token
      from regexp_matches(lower(left(coalesce(p_text, ''), 1000)), '([a-z0-9]+(?:-[a-z0-9]+)*)', 'g') as m
     limit 60
  )
  select s.seller_account_id
    from tokens t
    join public.shops s
      on (t.token like 'shop-%' and s.slug_code = substr(t.token, 6))
      or (position('-' in t.token) > 0 and s.slug = t.token)
    join public.seller_accounts a on a.id = s.seller_account_id
   where s.status = 'published'
     and a.status in ('pending', 'active')
   limit 1;
$$;

revoke all on function public.wa_find_shop_in_text(text) from public, anon, authenticated;
grant execute on function public.wa_find_shop_in_text(text) to service_role;

create or replace function public.wa_record_inbound(
  p_wamid text,
  p_from text,
  p_type text,
  p_body text,
  p_media_id text default null,
  p_media_mime text default null,
  p_sent_at timestamptz default null
)
returns table (
  message_id uuid,
  conversation_id uuid,
  seller_account_id uuid,
  duplicate boolean,
  newly_bound boolean
)
language plpgsql
security definer
set search_path = ''
as $$
-- The OUT columns share names with table columns (seller_account_id,
-- conversation_id); they are only ever written positionally by RETURN QUERY,
-- so every bare reference means the column.
#variable_conflict use_column
declare
  v_named_seller uuid;
  v_conversation public.wa_conversations;
  v_unbound_id uuid;
  v_message_id uuid;
  v_newly_bound boolean := false;
  v_at timestamptz := least(coalesce(p_sent_at, now()), now());
begin
  if exists (select 1 from public.wa_messages m where m.wamid = p_wamid) then
    return query select null::uuid, null::uuid, null::uuid, true, false;
    return;
  end if;

  v_named_seller := public.wa_find_shop_in_text(p_body);
  select c.id into v_unbound_id
    from public.wa_conversations c
   where c.buyer_phone = p_from and c.seller_account_id is null;

  if v_named_seller is not null then
    select * into v_conversation
      from public.wa_conversations c
     where c.buyer_phone = p_from and c.seller_account_id = v_named_seller;
    if v_conversation.id is null then
      insert into public.wa_conversations (buyer_phone, seller_account_id)
      values (p_from, v_named_seller)
      on conflict (buyer_phone, seller_account_id) where seller_account_id is not null
      do update set updated_at = now()
      returning * into v_conversation;
      v_newly_bound := true;
    end if;
    -- Carry the pre-binding thread ("hi", "which shop is this?") across.
    if v_unbound_id is not null then
      update public.wa_messages set conversation_id = v_conversation.id where wa_messages.conversation_id = v_unbound_id;
      update public.wa_conversations c
         set unread_count = c.unread_count + u.unread_count,
             language = coalesce(c.language, u.language),
             disclosed_at = coalesce(c.disclosed_at, u.disclosed_at)
        from public.wa_conversations u
       where c.id = v_conversation.id and u.id = v_unbound_id;
      delete from public.wa_conversations where id = v_unbound_id;
      v_newly_bound := true;
    end if;
  else
    select * into v_conversation
      from public.wa_conversations c
     where c.buyer_phone = p_from
       and c.seller_account_id is not null
       and c.last_message_at > now() - interval '30 days'
     order by c.last_message_at desc
     limit 1;
    if v_conversation.id is null then
      insert into public.wa_conversations (buyer_phone)
      values (p_from)
      on conflict (buyer_phone) where seller_account_id is null do update set updated_at = now()
      returning * into v_conversation;
    end if;
  end if;

  insert into public.wa_messages (conversation_id, direction, wamid, type, body, media_id, media_mime, author, status, created_at)
  values (v_conversation.id, 'inbound', p_wamid, p_type, left(coalesce(p_body, ''), 4096), p_media_id, p_media_mime,
          'buyer', 'received', v_at)
  on conflict (wamid) do nothing
  returning id into v_message_id;

  -- Lost a race with a concurrent delivery of the same wamid.
  if v_message_id is null then
    return query select null::uuid, null::uuid, null::uuid, true, false;
    return;
  end if;

  update public.wa_conversations c
     set last_inbound_at = greatest(coalesce(c.last_inbound_at, v_at), v_at),
         last_message_at = now(),
         last_message_preview = left(coalesce(nullif(p_body, ''), '[' || p_type || ']'), 200),
         unread_count = c.unread_count + 1
   where c.id = v_conversation.id;

  perform public.emit_domain_event(
    'whatsapp', v_conversation.id, 'whatsapp.inbound',
    jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message_id),
    'wa:in:' || p_wamid
  );

  return query select v_message_id, v_conversation.id, v_conversation.seller_account_id, false, v_newly_bound;
end;
$$;

revoke all on function public.wa_record_inbound(text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.wa_record_inbound(text, text, text, text, text, text, timestamptz) to service_role;

-- Delivery receipts. Forward-only: Meta can deliver "delivered" after "read",
-- and a receipt must never move a message backwards.
create or replace function public.wa_apply_status(p_wamid text, p_status text, p_error text default null)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with ranked as (
    select case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end as next_rank
  )
  update public.wa_messages m
     set status = p_status,
         error = case when p_status = 'failed' then left(p_error, 500) else m.error end
    from ranked r
   where m.wamid = p_wamid
     and m.direction = 'outbound'
     and r.next_rank > 0
     and r.next_rank > case m.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end
     -- A read message did arrive; a late "failed" does not undo that.
     and not (p_status = 'failed' and m.status = 'read')
  returning true;
$$;

revoke all on function public.wa_apply_status(text, text, text) from public, anon, authenticated;
grant execute on function public.wa_apply_status(text, text, text) to service_role;

-- One agent turn per conversation at a time. A lease rather than a held row
-- lock: the turn spans model calls that outlive any one transaction, and a
-- worker that dies mid-turn must not wedge the conversation — the lease simply
-- expires. `skip locked` means a second worker gives up at once instead of
-- queueing behind the first.
create or replace function public.wa_claim_conversation(p_conversation_id uuid, p_lease_seconds integer default 90)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id
    from public.wa_conversations c
   where c.id = p_conversation_id
     and (c.agent_lock_until is null or c.agent_lock_until < now())
   for update skip locked;
  if v_id is null then
    return false;
  end if;
  update public.wa_conversations
     set agent_lock_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 10), 300))
   where id = v_id;
  return true;
end;
$$;

create or replace function public.wa_release_conversation(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.wa_conversations set agent_lock_until = null where id = p_conversation_id;
$$;

revoke all on function public.wa_claim_conversation(uuid, integer) from public, anon, authenticated;
revoke all on function public.wa_release_conversation(uuid) from public, anon, authenticated;
grant execute on function public.wa_claim_conversation(uuid, integer) to service_role;
grant execute on function public.wa_release_conversation(uuid) to service_role;
