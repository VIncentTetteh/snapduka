-- Seller trust score (202609250144): tiers, the evidence rule, bounded
-- batches, and that buyers cannot read anyone's breakdown.

begin;

set local search_path = extensions, public;

select plan(14);

-- Three sellers: an established verified one, a brand-new one, and an
-- established one with a bad refund and dispute record.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('68680000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'trust' || n || '@test', now(), now()
from generate_series(1, 3) as n;

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, created_at)
values
  ('68680000-0000-4000-8000-0000000000a1', '68680000-0000-4000-8000-000000000001', 'GH', 'active', true, 'Good', now() - interval '400 days'),
  ('68680000-0000-4000-8000-0000000000a2', '68680000-0000-4000-8000-000000000002', 'GH', 'active', true, 'New', now() - interval '3 days'),
  ('68680000-0000-4000-8000-0000000000a3', '68680000-0000-4000-8000-000000000003', 'GH', 'active', true, 'Bad', now() - interval '400 days');

insert into public.seller_verifications (seller_account_id, state, provider, provider_reference, checked_at)
values ('68680000-0000-4000-8000-0000000000a1', 'verified', 'operator', 'op-t1', now());

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
select ('68680000-0000-4000-8000-0000000000b' || n)::uuid, ('68680000-0000-4000-8000-0000000000a' || n)::uuid,
       'trust-shop-' || n, 'Trust Shop ' || n, 'GH', 'GHS', 'published', now()
from generate_series(1, 3) as n;

insert into public.customers (id, seller_account_id, name, email, phone, country)
select ('68680000-0000-4000-8000-0000000000c' || n)::uuid, ('68680000-0000-4000-8000-0000000000a' || n)::uuid,
       'Buyer', 'buyer' || n || '@trust.test', '+23320123450' || n, 'GH'
from generate_series(1, 3) as n;

-- 40 completed orders for the good seller, shipped within a few hours.
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot, created_at)
select gen_random_uuid(), '68680000-0000-4000-8000-0000000000b1', '68680000-0000-4000-8000-0000000000a1',
       '68680000-0000-4000-8000-0000000000c1', 'GHS', 'completed', 'paid', 'fulfilled', 'paystack',
       1000, 0, 1000, '{}'::jsonb, '{"type":"delivery"}'::jsonb, now() - (n || ' days')::interval
from generate_series(1, 40) as n;
insert into public.shipments (seller_account_id, order_id, provider, tracking_number, created_at)
select o.seller_account_id, o.id, 'bolt', 'T-' || left(o.id::text, 8), o.created_at + interval '3 hours'
  from public.orders o where o.seller_account_id = '68680000-0000-4000-8000-0000000000a1';

-- 20 completed orders for the bad seller, 6 of them refunded and 4 disputed.
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor, refund_status,
  buyer_snapshot, fulfillment_method_snapshot, created_at)
select gen_random_uuid(), '68680000-0000-4000-8000-0000000000b3', '68680000-0000-4000-8000-0000000000a3',
       '68680000-0000-4000-8000-0000000000c3', 'GHS', 'completed', 'paid', 'fulfilled', 'paystack',
       1000, 0, 1000, case when n <= 6 then 'completed'::public.refund_status else 'none'::public.refund_status end,
       '{}'::jsonb, '{"type":"delivery"}'::jsonb, now() - (n || ' days')::interval
from generate_series(1, 20) as n;
insert into public.support_cases (order_id, seller_account_id, reason, description)
select o.id, o.seller_account_id, 'item_not_received', 'Never arrived'
  from public.orders o where o.seller_account_id = '68680000-0000-4000-8000-0000000000a3'
 order by o.created_at limit 4;

-- ── a bounded batch ─────────────────────────────────────────────────────────
select is((select processed from public.compute_seller_trust_scores(1, null)), 1,
  'a batch scores at most p_batch sellers');
select cmp_ok((select count(*)::int from public.seller_trust_scores
                where seller_account_id::text like '68680000%'), '<=', 1,
  'and writes no more than that');

select cmp_ok(public.run_seller_trust_scores(2), '>=', 3, 'the nightly run walks every seller in batches');

-- ── tiers ───────────────────────────────────────────────────────────────────
select is((select tier from public.seller_trust_scores where seller_account_id = '68680000-0000-4000-8000-0000000000a1'),
  'gold', 'an established, verified, fast seller with no refunds is gold');
select is((select tier from public.seller_trust_scores where seller_account_id = '68680000-0000-4000-8000-0000000000a2'),
  'new', 'a seller with no history is new, whatever the arithmetic says');
select is((select (components ->> 'refundRate')::numeric from public.seller_trust_scores
            where seller_account_id = '68680000-0000-4000-8000-0000000000a3'),
  0.00, 'a 30% refund rate scores nothing for refunds');
select is((select (components ->> 'disputeRate')::numeric from public.seller_trust_scores
            where seller_account_id = '68680000-0000-4000-8000-0000000000a3'),
  0.00, 'a 20% dispute rate scores nothing for disputes');
select cmp_ok(
  (select score from public.seller_trust_scores where seller_account_id = '68680000-0000-4000-8000-0000000000a3'),
  '<',
  (select score from public.seller_trust_scores where seller_account_id = '68680000-0000-4000-8000-0000000000a1'),
  'refunds and disputes cost score');
select is((select (components ->> 'refundRate')::numeric from public.seller_trust_scores
            where seller_account_id = '68680000-0000-4000-8000-0000000000a2'),
  7.50, 'no history is neutral: half the weight, neither reward nor penalty');
select is((select weights_version from public.seller_trust_scores
            where seller_account_id = '68680000-0000-4000-8000-0000000000a1'),
  'v1', 'every score records the weights it was computed with');

-- ── idempotent ──────────────────────────────────────────────────────────────
select public.run_seller_trust_scores(500);
select is((select count(*)::int from public.seller_trust_scores where seller_account_id::text like '68680000%'),
  3, 'recomputing updates in place');

-- ── access ──────────────────────────────────────────────────────────────────
select ok(not has_table_privilege('anon', 'public.seller_trust_scores', 'select'),
  'buyers cannot read score breakdowns');
select ok(not has_function_privilege('authenticated', 'public.compute_seller_trust_scores(integer,uuid)', 'execute'),
  'no client can trigger a recompute');
select ok(exists(select 1 from cron.job where jobname = 'snapduka-trust-scores'),
  'scores are recomputed nightly');

select * from finish();
rollback;
