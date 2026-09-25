-- Stock financing eligibility and offers: every input is read from data
-- SnapDuka holds, every failing reason is reported, and acceptance is of the
-- exact terms the seller was shown.

begin;

set local search_path = extensions, public;

select plan(21);

-- ---------------------------------------------------------------------------
-- Fixtures: seller A has 25 paid GH₵300 orders on the ledger; seller B is new.
-- ---------------------------------------------------------------------------
update public.country_configs set platform_fee_bps = 700, payout_hold_days = 3 where country = 'GH';
update public.financing_policies
   set enabled = false, min_account_age_days = 180, min_gmv_90d_minor = 500000, min_orders_90d = 20,
       max_refund_rate_bps = 500, max_chargeback_rate_bps = 100, eligible_tiers = array['silver', 'gold'],
       require_verified = true, offer_gmv_bps = 2500, min_offer_minor = 50000, max_offer_minor = 5000000,
       fee_bps = 600, sweep_bps = 1500, platform_fee_share_bps = 0, offer_valid_days = 14, terms_version = 'v1',
       partner = 'sandbox'
 where country = 'GH';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('08500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'fin-a@example.com', now(), now()),
       ('08500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'fin-b@example.com', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, settlement_mode_override, created_at)
values ('08500000-0000-4000-8000-0000000000a1', '08500000-0000-4000-8000-000000000001', 'GH', 'active', true,
        'Fin A', 'fin-a@example.com', 'ledger', now() - interval '400 days'),
       ('08500000-0000-4000-8000-0000000000a2', '08500000-0000-4000-8000-000000000002', 'GH', 'active', true,
        'Fin B', 'fin-b@example.com', 'ledger', now() - interval '10 days');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('08500000-0000-4000-8000-0000000000b1', '08500000-0000-4000-8000-0000000000a1',
        'fin-shop-a', 'Fin Shop A', 'Fin Shop A Ltd', 'GH', 'GHS', 'published', now());
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('08500000-0000-4000-8000-0000000000c1', '08500000-0000-4000-8000-0000000000a1',
        'Kofi Buyer', 'kofi@example.com', '+233241110085', 'GH');

insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor,
                           delivery_minor, total_minor, payment_method, fulfillment_method_snapshot, buyer_snapshot)
select gen_random_uuid(), '08500000-0000-4000-8000-0000000000b1', '08500000-0000-4000-8000-0000000000a1',
       '08500000-0000-4000-8000-0000000000c1', 'GHS', 30000, 0, 30000, 'paystack', '{}'::jsonb,
       '{"name":"Kofi","phone":"+233241110085"}'::jsonb
  from generate_series(1, 25);

do $$
declare o record;
begin
  for o in select id, total_minor, seller_account_id from public.orders
            where seller_account_id = '08500000-0000-4000-8000-0000000000a1' loop
    insert into public.payment_attempts (order_id, seller_account_id, reference, amount_minor, currency, status)
    values (o.id, o.seller_account_id, 'fin085_' || o.id, o.total_minor, 'GHS', 'pending');
    perform public.apply_paystack_success('fin085_' || o.id, 'evt:fin085_' || o.id,
      jsonb_build_object('data', jsonb_build_object('status', 'success', 'amount', o.total_minor,
                                                    'currency', 'GHS', 'fees', 0)));
  end loop;
end $$;

create or replace function pg_temp.elig(p uuid) returns jsonb language sql as $$
  select public.financing_eligibility(p);
$$;
create or replace function pg_temp.has_reason(p uuid, r text) returns boolean language sql as $$
  select (public.financing_eligibility(p)->'reasons') ? r;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------
select ok(pg_temp.has_reason('08500000-0000-4000-8000-0000000000a1', 'market_not_available'),
  'a market whose policy is disabled offers nothing');

update public.financing_policies set enabled = true where country = 'GH';

select ok(pg_temp.has_reason('08500000-0000-4000-8000-0000000000a1', 'not_verified')
          and pg_temp.has_reason('08500000-0000-4000-8000-0000000000a1', 'trust_tier'),
  'every failing reason is reported, not just the first');

insert into public.seller_verifications (seller_account_id, state, provider, provider_reference, checked_at)
values ('08500000-0000-4000-8000-0000000000a1', 'verified', 'operator', 'test', now())
on conflict (seller_account_id) do update set state = 'verified', checked_at = now();
insert into public.seller_trust_scores (seller_account_id, score, tier, components, weights_version)
values ('08500000-0000-4000-8000-0000000000a1', 85, 'gold', '{}'::jsonb, 'v1');

select is((pg_temp.elig('08500000-0000-4000-8000-0000000000a1')->>'eligible')::boolean, true,
  'a verified gold seller with 90 days of ledger sales qualifies');
select is((pg_temp.elig('08500000-0000-4000-8000-0000000000a1')->>'gmv90dMinor')::bigint, 750000::bigint,
  'GMV is the ledger-captured goods + delivery over 90 days');
select is(pg_temp.elig('08500000-0000-4000-8000-0000000000a1')->'offer',
  jsonb_build_object('principalMinor', 187500, 'feeBps', 600, 'feeMinor', 11250, 'totalRepayableMinor', 198750,
                     'sweepBps', 1500, 'platformFeeShareMinor', 0, 'termsVersion', 'v1', 'validDays', 14),
  'offer = 25% of GMV, fixed 6% fee, 15% sweep, all from the policy row');

update public.financing_policies set max_offer_minor = 100000 where country = 'GH';
select is((pg_temp.elig('08500000-0000-4000-8000-0000000000a1')->'offer'->>'principalMinor')::bigint, 100000::bigint,
  'the offer is capped by the market maximum');
update public.financing_policies set max_offer_minor = 5000000 where country = 'GH';

select ok(pg_temp.has_reason('08500000-0000-4000-8000-0000000000a2', 'account_too_new')
          and pg_temp.has_reason('08500000-0000-4000-8000-0000000000a2', 'sales_too_low')
          and pg_temp.has_reason('08500000-0000-4000-8000-0000000000a2', 'too_few_orders'),
  'a new seller with no sales does not qualify');

update public.seller_accounts set settlement_mode_override = 'subaccount'
 where id = '08500000-0000-4000-8000-0000000000a1';
select ok(pg_temp.has_reason('08500000-0000-4000-8000-0000000000a1', 'not_on_ledger'),
  'a seller off the ledger cannot be repaid by a sweep, so does not qualify');
update public.seller_accounts set settlement_mode_override = 'ledger'
 where id = '08500000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------
select is(public.create_financing_offer('08500000-0000-4000-8000-0000000000a2'), null::uuid,
  'no offer for a seller who does not qualify');

create temporary table t_offer as
select public.create_financing_offer('08500000-0000-4000-8000-0000000000a1') as id;

select is(public.create_financing_offer('08500000-0000-4000-8000-0000000000a1'), (select id from t_offer),
  'an open offer is returned as is, not re-priced under the seller');

-- Expiry.
update public.financing_offers set expires_at = now() - interval '1 minute' where id = (select id from t_offer);
select throws_ok(
  format($$select public.accept_financing_offer(%L, '08500000-0000-4000-8000-0000000000a1',
                  '08500000-0000-4000-8000-000000000001', 198750, 'v1')$$, (select id from t_offer)),
  '55000', null, 'an expired offer cannot be accepted');

select isnt(public.create_financing_offer('08500000-0000-4000-8000-0000000000a1'), (select id from t_offer),
  'an expired offer is replaced by a fresh one');
select is((select status from public.financing_offers where id = (select id from t_offer)), 'expired',
  'and is marked expired');

update t_offer set id = (select id from public.financing_offers
                          where seller_account_id = '08500000-0000-4000-8000-0000000000a1' and status = 'open');

select throws_ok(
  format($$select public.accept_financing_offer(%L, '08500000-0000-4000-8000-0000000000a1',
                  '08500000-0000-4000-8000-000000000001', 198000, 'v1')$$, (select id from t_offer)),
  '55000', null, 'accepting a total other than the one shown is refused');
select throws_ok(
  format($$select public.accept_financing_offer(%L, '08500000-0000-4000-8000-0000000000a1',
                  '08500000-0000-4000-8000-000000000001', 198750, 'v0')$$, (select id from t_offer)),
  '55000', null, 'accepting an old terms version is refused');
select throws_ok(
  format($$select public.accept_financing_offer(%L, '08500000-0000-4000-8000-0000000000a2',
                  '08500000-0000-4000-8000-000000000002', 198750, 'v1')$$, (select id from t_offer)),
  'P0002', null, 'another seller cannot accept this offer');

create temporary table t_adv as
select public.accept_financing_offer((select id from t_offer), '08500000-0000-4000-8000-0000000000a1',
                                     '08500000-0000-4000-8000-000000000001', 198750, 'v1') as id;

select is((select row(state, principal_minor, total_repayable_minor, partner_share_minor, partner)::text
             from public.financing_advances where id = (select id from t_adv)),
  '(accepted,187500,198750,198750,sandbox)', 'acceptance creates an advance awaiting funding; no money yet');
select is((select count(*)::int from public.ledger_transactions where kind like 'financing%'
             and seller_account_id = '08500000-0000-4000-8000-0000000000a1'), 0,
  'accepting moves no money');
select ok(pg_temp.has_reason('08500000-0000-4000-8000-0000000000a1', 'active_advance')
          and public.create_financing_offer('08500000-0000-4000-8000-0000000000a1') is null,
  'one live advance per seller');

-- Chargebacks count against the rate.
insert into public.payment_disputes (provider_dispute_id, order_id, seller_account_id, currency, amount_minor)
select 'dsp085_' || o.id, o.id, o.seller_account_id, 'GHS', 1000
  from public.orders o where o.seller_account_id = '08500000-0000-4000-8000-0000000000a1' limit 2;
select is((pg_temp.elig('08500000-0000-4000-8000-0000000000a1')->>'chargebackRateBps')::int, 800,
  'chargeback rate = disputes per captured order (2 of 25)');

set local role authenticated;
select throws_ok($$select public.financing_eligibility('08500000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'eligibility is server-only');
reset role;

select * from finish();
rollback;
