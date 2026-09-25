-- WhatsApp Cloud API: conversations, messages and the template registry.
--
-- SnapDuka talks WhatsApp through Meta's Cloud API on one shared number (the
-- MVP; sellers' own numbers via Embedded Signup come later). Meta's rules decide
-- the shape of this schema:
--
--  * A free-form message may only be sent within 24 hours of the buyer's last
--    message to us (the customer-service window). Outside it, only a
--    pre-approved template may be sent. `wa_conversations.last_inbound_at` is
--    the record that window is checked against.
--  * Templates are registered and approved by Meta out of band. `wa_templates`
--    mirrors what has been submitted and whether it was approved, so code never
--    sends a template Meta will reject — a rejected send is a notification that
--    silently never arrives.
--
-- One conversation per (buyer phone, seller). A phone that has not yet named a
-- shop has a single unbound conversation (seller null) until it does. The
-- seller never reads these tables directly: the inbox is served by server
-- routes that filter by seller explicitly, so every table here is service-role
-- only, and the buyer's phone number is not exposed to team roles that should
-- not see it through a forgotten policy.

create table public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  buyer_phone text not null,
  seller_account_id uuid references public.seller_accounts (id) on delete cascade,
  -- agent: the assistant answers. human: a person from the shop answers, until
  -- human_until. paused: nobody answers automatically (seller's choice).
  mode text not null default 'agent',
  human_until timestamptz,
  assigned_member_id uuid references public.team_memberships (id) on delete set null,
  language text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  unread_count integer not null default 0,
  -- When the buyer was told they are talking to an automated assistant. Set
  -- once, on the first automated reply.
  disclosed_at timestamptz,
  -- Lease for the agent worker: one turn per conversation at a time.
  agent_lock_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_conversations_phone_check check (buyer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint wa_conversations_mode_check check (mode in ('agent', 'human', 'paused')),
  constraint wa_conversations_language_check check (language is null or language in ('en', 'pcm', 'tw')),
  constraint wa_conversations_unread_check check (unread_count >= 0),
  constraint wa_conversations_preview_check check (length(last_message_preview) <= 200)
);

comment on table public.wa_conversations is
  'One WhatsApp conversation per (buyer phone, seller); seller null until the buyer names a shop. Service-role only.';
comment on column public.wa_conversations.last_inbound_at is
  'The buyer''s last message. Free-form replies are allowed only within 24h of this (Meta customer-service window).';

create unique index wa_conversations_bound_key on public.wa_conversations (buyer_phone, seller_account_id)
  where seller_account_id is not null;
create unique index wa_conversations_unbound_key on public.wa_conversations (buyer_phone)
  where seller_account_id is null;
create index wa_conversations_inbox on public.wa_conversations (seller_account_id, last_message_at desc, id desc)
  where seller_account_id is not null;
create index wa_conversations_phone_recent on public.wa_conversations (buyer_phone, last_inbound_at desc nulls last);
create index wa_conversations_assigned_member on public.wa_conversations (assigned_member_id)
  where assigned_member_id is not null;

create trigger wa_conversations_set_updated_at
  before update on public.wa_conversations
  for each row execute function public.set_updated_at();

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations (id) on delete cascade,
  direction text not null,
  -- Meta's message id. Unique, so a webhook Meta retries is stored once.
  -- Null only for an outbound message Meta never accepted.
  wamid text,
  type text not null,
  body text not null default '',
  media_id text,
  media_mime text,
  template_name text,
  author text not null,
  author_user_id uuid references auth.users (id) on delete set null,
  status text not null,
  error text,
  -- When the agent pipeline finished with this inbound message (answered,
  -- handed off, or deliberately left for a human). Null = still to do.
  agent_handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wa_messages_wamid_key unique (wamid),
  constraint wa_messages_direction_check check (direction in ('inbound', 'outbound')),
  constraint wa_messages_type_check check (type in (
    'text', 'image', 'audio', 'voice', 'video', 'document', 'sticker', 'location',
    'interactive', 'button', 'template', 'reaction', 'unsupported'
  )),
  constraint wa_messages_author_check check (author in ('buyer', 'agent', 'seller', 'system')),
  constraint wa_messages_direction_author_check check ((direction = 'inbound') = (author = 'buyer')),
  constraint wa_messages_status_check check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  constraint wa_messages_body_check check (length(body) <= 4096),
  constraint wa_messages_error_check check (error is null or length(error) <= 500)
);

comment on table public.wa_messages is
  'Every WhatsApp message in or out, deduplicated on Meta''s wamid. Service-role only.';

create index wa_messages_thread on public.wa_messages (conversation_id, created_at desc, id desc);
create index wa_messages_unhandled on public.wa_messages (conversation_id, created_at)
  where direction = 'inbound' and agent_handled_at is null;
create index wa_messages_author_user on public.wa_messages (author_user_id) where author_user_id is not null;

create table public.wa_templates (
  name text not null,
  language text not null default 'en',
  category text not null,
  -- Who may receive it. `delivery_code` is buyer-only: the code is what proves
  -- the goods arrived, and a seller holding it could confirm their own delivery.
  audience text not null,
  body text not null,
  -- Parameter names in {{1}}, {{2}}... order. Code fills them by name.
  parameters text[] not null default '{}',
  status text not null default 'draft',
  meta_template_id text,
  updated_at timestamptz not null default now(),
  primary key (name, language),
  constraint wa_templates_name_check check (name ~ '^[a-z][a-z0-9_]{1,100}$'),
  constraint wa_templates_category_check check (category in ('utility', 'marketing', 'authentication')),
  constraint wa_templates_audience_check check (audience in ('buyer', 'seller')),
  constraint wa_templates_status_check check (status in ('draft', 'submitted', 'approved', 'rejected', 'paused'))
);

comment on table public.wa_templates is
  'Mirror of templates submitted to Meta. Code sends only rows with status approved. Service-role only.';

create trigger wa_templates_set_updated_at
  before update on public.wa_templates
  for each row execute function public.set_updated_at();

-- Meta has no Twi or Pidgin templates, so every template is English; Twi and
-- Pidgin happen in free-form messages inside the 24h window. Seeded as draft:
-- they become sendable only when someone records Meta's approval.
insert into public.wa_templates (name, language, category, audience, body, parameters)
values
  ('order_confirmed', 'en', 'utility', 'buyer',
   'Your order {{1}} from {{2}} is confirmed. Track it here: {{3}}',
   array['reference', 'shop_name', 'tracking_url']),
  ('order_dispatched', 'en', 'utility', 'buyer',
   'Your order {{1}} from {{2}} is on its way. Track it here: {{3}}',
   array['reference', 'shop_name', 'tracking_url']),
  -- Utility, not authentication: Meta's authentication category only allows its
  -- own fixed "is your verification code" text, which would not tell the buyer
  -- to withhold the code until the goods are in hand.
  ('delivery_code', 'en', 'utility', 'buyer',
   '{{1}} is your SnapDuka delivery code for order {{2}}. Give it to the rider only when you have your order.',
   array['code', 'reference']),
  ('payout_sent', 'en', 'utility', 'seller',
   'SnapDuka has sent your payout of {{1}} to {{2}}. Reference: {{3}}',
   array['amount', 'destination', 'reference'])
on conflict (name, language) do nothing;

alter table public.wa_conversations enable row level security;
alter table public.wa_conversations force row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_messages force row level security;
alter table public.wa_templates enable row level security;
alter table public.wa_templates force row level security;
revoke all on public.wa_conversations from anon, authenticated;
revoke all on public.wa_messages from anon, authenticated;
revoke all on public.wa_templates from anon, authenticated;

-- Record an outbound message and move the conversation along with it, in one
-- transaction: a message without its conversation's last_outbound_at, or the
-- reverse, would make the inbox and the 24h check disagree.
--
-- Finds the (phone, seller) conversation or opens one: an order confirmation
-- starts the thread the buyer's reply will land in.
create or replace function public.wa_record_outbound(
  p_buyer_phone text,
  p_type text,
  p_body text,
  p_author text,
  p_status text,
  -- Null for a message on nobody's behalf (the "which shop?" prompt).
  p_seller_account_id uuid default null,
  -- Null when Meta refused the message and never assigned an id.
  p_wamid text default null,
  p_template_name text default null,
  p_author_user_id uuid default null,
  p_error text default null,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid := p_conversation_id;
  v_message_id uuid;
begin
  if v_conversation_id is null then
    if p_seller_account_id is null then
      select id into v_conversation_id
        from public.wa_conversations
       where buyer_phone = p_buyer_phone and seller_account_id is null;
      if v_conversation_id is null then
        insert into public.wa_conversations (buyer_phone)
        values (p_buyer_phone)
        on conflict (buyer_phone) where seller_account_id is null do update set updated_at = now()
        returning id into v_conversation_id;
      end if;
    else
      insert into public.wa_conversations (buyer_phone, seller_account_id)
      values (p_buyer_phone, p_seller_account_id)
      on conflict (buyer_phone, seller_account_id) where seller_account_id is not null
      do update set updated_at = now()
      returning id into v_conversation_id;
    end if;
  end if;

  insert into public.wa_messages (
    conversation_id, direction, wamid, type, body, template_name, author, author_user_id, status, error
  )
  values (
    v_conversation_id, 'outbound', p_wamid, p_type, left(coalesce(p_body, ''), 4096), p_template_name,
    p_author, p_author_user_id, p_status, left(p_error, 500)
  )
  returning id into v_message_id;

  update public.wa_conversations
     set last_outbound_at = case when p_status = 'failed' then last_outbound_at else now() end,
         last_message_at = now(),
         last_message_preview = left(coalesce(nullif(p_body, ''), '[' || p_type || ']'), 200)
   where id = v_conversation_id;

  return v_message_id;
end;
$$;

revoke all on function public.wa_record_outbound(text, text, text, text, text, uuid, text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.wa_record_outbound(text, text, text, text, text, uuid, text, text, uuid, text, uuid)
  to service_role;
