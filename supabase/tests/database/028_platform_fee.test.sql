-- The platform fee decides what every seller earns on every online sale, so
-- the guards around it are pinned rather than left to review.

begin;
select plan(8);

select has_column('public', 'country_configs', 'platform_fee_bps',
  'country_configs carries the platform fee');
select has_column('public', 'payment_subaccounts', 'percentage_charge_bps',
  'payment_subaccounts records the rate actually applied at the provider');

select is(
  (select count(*)::int from public.country_configs where platform_fee_bps = 700),
  (select count(*)::int from public.country_configs),
  'every market is on 7%'
);

-- An accidental 0 would mean SnapDuka takes nothing and pays Paystack's fee out
-- of its own pocket on every sale.
select throws_ok(
  $$update public.country_configs set platform_fee_bps = 0 where country = 'GH'$$,
  '23514',
  null,
  'a zero fee is rejected'
);

-- 10000 bps would leave the seller with nothing at all.
select throws_ok(
  $$update public.country_configs set platform_fee_bps = 10000 where country = 'GH'$$,
  '23514',
  null,
  'a fee that zeroes the seller is rejected'
);

select throws_ok(
  $$update public.country_configs set platform_fee_bps = -100 where country = 'GH'$$,
  '23514',
  null,
  'a negative fee is rejected'
);

select lives_ok(
  $$update public.country_configs set platform_fee_bps = 1200 where country = 'GH'$$,
  'a rate inside the allowed band is accepted'
);

-- NULL is meaningful on the subaccount column: it marks a row that predates
-- the column and whose real rate at Paystack is unknown.
select col_is_null('public', 'payment_subaccounts', 'percentage_charge_bps',
  'an unreconciled subaccount rate is allowed to be unknown');

select * from finish();
rollback;
