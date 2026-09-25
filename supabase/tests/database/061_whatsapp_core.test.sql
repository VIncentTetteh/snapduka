-- WhatsApp conversations, messages, templates and wa_record_outbound (202609250121).

begin;

set local search_path = extensions, public;

select plan(18);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('61600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'wa@core.test', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('61610000-0000-4000-8000-000000000001', '61600000-0000-4000-8000-000000000001', 'GH', 'active', true, 'WA Seller');

-- ---------------------------------------------------------------------------
-- Exposure: the inbox is served by server routes; nothing here is readable
-- with a user's JWT, so a forgotten policy cannot leak a buyer's phone number.
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.wa_conversations', 'select'),
  'authenticated cannot read conversations');
select ok(not has_table_privilege('authenticated', 'public.wa_messages', 'select'),
  'authenticated cannot read messages');
select ok(not has_table_privilege('anon', 'public.wa_templates', 'select'),
  'anon cannot read templates');
select ok(not has_function_privilege('authenticated',
  'public.wa_record_outbound(text,text,text,text,text,uuid,text,text,uuid,text,uuid)', 'execute'),
  'authenticated cannot record outbound messages');
select is(
  (select count(*)::int from pg_class
    where oid in ('public.wa_conversations'::regclass, 'public.wa_messages'::regclass, 'public.wa_templates'::regclass)
      and relforcerowsecurity),
  3, 'all three tables force RLS');

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.wa_templates
            where name in ('order_confirmed', 'order_dispatched', 'delivery_code', 'payout_sent')), 4,
  'the four utility templates are registered');
select is((select audience from public.wa_templates where name = 'delivery_code'), 'buyer',
  'the delivery code is a buyer-only template');
select is((select count(*)::int from public.wa_templates where status = 'approved'), 0,
  'nothing is sendable until Meta''s approval is recorded');

-- ---------------------------------------------------------------------------
-- Conversation keys
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.wa_conversations (buyer_phone) values ('0201234567')$$,
  '23514', null, 'phones are E.164');
insert into public.wa_conversations (buyer_phone) values ('+233201111111');
select throws_ok(
  $$insert into public.wa_conversations (buyer_phone) values ('+233201111111')$$,
  '23505', null, 'one unbound conversation per phone');
insert into public.wa_conversations (buyer_phone, seller_account_id)
values ('+233201111111', '61610000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.wa_conversations (buyer_phone, seller_account_id)
    values ('+233201111111', '61610000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one conversation per (phone, seller)');

-- ---------------------------------------------------------------------------
-- wa_record_outbound
-- ---------------------------------------------------------------------------
select isnt(
  public.wa_record_outbound('+233202222222', 'template', 'Your order SD-1 is confirmed.', 'system', 'sent',
    p_seller_account_id => '61610000-0000-4000-8000-000000000001', p_wamid => 'wamid.OUT1',
    p_template_name => 'order_confirmed'),
  null, 'records an outbound message');
select is(
  (select count(*)::int from public.wa_conversations
    where buyer_phone = '+233202222222' and seller_account_id = '61610000-0000-4000-8000-000000000001'),
  1, 'an order message opens the conversation the buyer''s reply will land in');
select isnt((select last_outbound_at from public.wa_conversations where buyer_phone = '+233202222222'), null,
  'and stamps last_outbound_at');
select is((select last_inbound_at from public.wa_conversations where buyer_phone = '+233202222222'), null,
  'without opening the 24h window, which only the buyer can do');

select public.wa_record_outbound('+233202222222', 'text', 'Second', 'seller', 'sent',
  p_seller_account_id => '61610000-0000-4000-8000-000000000001', p_wamid => 'wamid.OUT2');
select is(
  (select count(*)::int from public.wa_conversations where buyer_phone = '+233202222222'),
  1, 'a second message reuses the conversation');

select throws_ok(
  $$select public.wa_record_outbound('+233202222222', 'text', 'Dup', 'seller', 'sent',
      p_seller_account_id => '61610000-0000-4000-8000-000000000001', p_wamid => 'wamid.OUT2')$$,
  '23505', null, 'wamid is unique');

select throws_ok(
  $$insert into public.wa_messages (conversation_id, direction, type, author, status)
    select id, 'outbound', 'text', 'buyer', 'sent' from public.wa_conversations limit 1$$,
  '23514', null, 'an outbound message cannot be authored by the buyer');

select * from finish();
rollback;
