-- WhatsApp inbound routing, dedupe, receipts and the agent lease (202609250122).

begin;

set local search_path = extensions, public;

select plan(27);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('62600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wa-in-a@test.test', now(), now()),
  ('62600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wa-in-b@test.test', now(), now()),
  ('62600000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wa-in-c@test.test', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values
  ('62610000-0000-4000-8000-000000000001', '62600000-0000-4000-8000-000000000001', 'GH', 'active', true, 'Kofi'),
  ('62610000-0000-4000-8000-000000000002', '62600000-0000-4000-8000-000000000002', 'GH', 'active', true, 'Ama'),
  ('62610000-0000-4000-8000-000000000003', '62600000-0000-4000-8000-000000000003', 'GH', 'suspended', false, 'Gone');
insert into public.shops (id, seller_account_id, slug, slug_code, display_name, country, currency, status, published_at)
values
  ('62620000-0000-4000-8000-000000000001', '62610000-0000-4000-8000-000000000001',
   'kofi-shoes-k7m2', 'k7m2', 'Kofi Shoes', 'GH', 'GHS', 'published', now()),
  ('62620000-0000-4000-8000-000000000002', '62610000-0000-4000-8000-000000000002',
   'shoes', 'a9x4', 'Ama', 'GH', 'GHS', 'published', now()),
  ('62620000-0000-4000-8000-000000000003', '62610000-0000-4000-8000-000000000003',
   'gone-shop-z3z3', 'z3z3', 'Gone', 'GH', 'GHS', 'published', now());

-- ---------------------------------------------------------------------------
-- Exposure
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.wa_record_inbound(text,text,text,text,text,text,timestamptz)', 'execute'),
  'the webhook RPC is not callable by anon');
select ok(not has_function_privilege('authenticated', 'public.wa_claim_conversation(uuid,integer)', 'execute'),
  'the agent lease is not callable by users');
select ok(has_function_privilege('service_role', 'public.wa_record_inbound(text,text,text,text,text,text,timestamptz)', 'execute'),
  'the server records inbound messages');

-- ---------------------------------------------------------------------------
-- Shop codes
-- ---------------------------------------------------------------------------
select is(public.wa_find_shop_in_text('Hi! I''m shopping at SHOP-K7M2'), '62610000-0000-4000-8000-000000000001'::uuid,
  'SHOP-<code> names a shop');
select is(public.wa_find_shop_in_text('saw this on snapduka.com/kofi-shoes-k7m2 yesterday'), '62610000-0000-4000-8000-000000000001'::uuid,
  'the storefront address names a shop');
select is(public.wa_find_shop_in_text('do you sell shoes?'), null,
  'a one-word legacy slug does not bind a buyer who merely mentions it');
select is(public.wa_find_shop_in_text('SHOP-A9X4'), '62610000-0000-4000-8000-000000000002'::uuid,
  'but that shop is reachable by its code');
select is(public.wa_find_shop_in_text('SHOP-Z3Z3'), null, 'a suspended seller''s shop does not bind');

-- ---------------------------------------------------------------------------
-- Unbound, then bound
-- ---------------------------------------------------------------------------
select is((select seller_account_id from public.wa_record_inbound('wamid.1', '+233201000001', 'text', 'hello')), null,
  'a first message naming no shop is unbound');
select is((select count(*)::int from public.domain_events
            where event_type = 'whatsapp.inbound' and dedupe_key = 'wa:in:wamid.1'), 1,
  'and still goes to the agent (which asks which shop)');

select is((select duplicate from public.wa_record_inbound('wamid.1', '+233201000001', 'text', 'hello')), true,
  'a redelivered wamid is a duplicate');
select is((select count(*)::int from public.wa_messages where wamid = 'wamid.1'), 1,
  'stored once');

select results_eq(
  $$select seller_account_id, newly_bound from public.wa_record_inbound('wamid.2', '+233201000001', 'text', 'SHOP-K7M2 hi')$$,
  $$values ('62610000-0000-4000-8000-000000000001'::uuid, true)$$,
  'naming a shop binds the conversation');
select is((select count(*)::int from public.wa_conversations where buyer_phone = '+233201000001' and seller_account_id is null), 0,
  'the unbound conversation is folded in');
select is(
  (select count(*)::int from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
    where c.buyer_phone = '+233201000001' and c.seller_account_id = '62610000-0000-4000-8000-000000000001'),
  2, 'so the seller sees the thread from the first "hello"');
select isnt((select last_inbound_at from public.wa_conversations where buyer_phone = '+233201000001'), null,
  'inbound opens the 24h window');
select is((select unread_count from public.wa_conversations where buyer_phone = '+233201000001'), 2,
  'and counts as unread');

select is((select seller_account_id from public.wa_record_inbound('wamid.3', '+233201000001', 'text', 'how much?')), '62610000-0000-4000-8000-000000000001'::uuid,
  'a follow-up with no code continues the same shop');

-- An order update from another shop makes that the buyer's current thread.
-- (now() is fixed inside this test's transaction, so age the first thread.)
update public.wa_conversations set last_message_at = now() - interval '1 hour'
 where buyer_phone = '+233201000001';
select public.wa_record_outbound('+233201000001', 'template', 'Your order is confirmed', 'system', 'sent',
  p_seller_account_id => '62610000-0000-4000-8000-000000000002', p_wamid => 'wamid.o1',
  p_template_name => 'order_confirmed');
select is((select seller_account_id from public.wa_record_inbound('wamid.4', '+233201000001', 'text', 'thanks!')), '62610000-0000-4000-8000-000000000002'::uuid,
  'a reply to an order update reaches the shop that sent it');

-- Future-dated timestamps from a skewed clock are clamped.
select public.wa_record_inbound('wamid.5', '+233201000002', 'text', 'hi', null, null, now() + interval '3 days');
select ok((select last_inbound_at <= now() from public.wa_conversations where buyer_phone = '+233201000002'),
  'a future timestamp cannot hold the window open');

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------
select is(public.wa_apply_status('wamid.o1', 'read'), true, 'read applies');
select is(public.wa_apply_status('wamid.o1', 'delivered'), null, 'a late "delivered" does not move it back');
select is(public.wa_apply_status('wamid.o1', 'failed', 'x'), null, 'nor does a late "failed" after read');
select is((select status from public.wa_messages where wamid = 'wamid.o1'), 'read', 'status stays read');

-- ---------------------------------------------------------------------------
-- Lease
-- ---------------------------------------------------------------------------
select is(public.wa_claim_conversation((select id from public.wa_conversations where buyer_phone = '+233201000002')), true,
  'the first worker claims the conversation');
select is(public.wa_claim_conversation((select id from public.wa_conversations where buyer_phone = '+233201000002')), false,
  'a second worker is turned away while the lease holds');
select public.wa_release_conversation((select id from public.wa_conversations where buyer_phone = '+233201000002'));
select is(public.wa_claim_conversation((select id from public.wa_conversations where buyer_phone = '+233201000002')), true,
  'released, it can be claimed again');

select * from finish();
rollback;
