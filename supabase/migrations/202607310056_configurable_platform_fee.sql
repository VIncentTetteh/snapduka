-- Makes SnapDuka's platform fee a setting instead of a constant, and drops it
-- from 10% to 7%.
--
-- The rate was hardcoded as PAYSTACK_PERCENTAGE_CHARGE = 10 in
-- src/app/(seller)/onboarding/actions.ts, so changing what SnapDuka earns on
-- every transaction in every market required a code deploy.
--
-- WHAT percentage_charge ACTUALLY MEANS — previously unconfirmed, now settled
-- against a live Paystack transaction:
--
--   amount 12000  ->  subaccount 10800 | integration 966 | paystack 234
--                     fees_split params: percentage_charge "10"
--
-- 10800 + 966 + 234 = 12000. So percentage_charge is the share SnapDuka (the
-- "integration", i.e. the main account) takes, the seller's subaccount receives
-- 100 - charge, and Paystack's own fee is deducted from SnapDuka's share rather
-- than the seller's. Going 10 -> 7 therefore pays sellers MORE (93% instead of
-- 90%) and reduces SnapDuka's take. It is not a cut to seller income.
--
-- Basis points, matching creator_partnerships.commission_rate_bps and the rest
-- of the money handling here — 700 = 7.00%. Percent-with-decimals is what the
-- Paystack API wants, and that conversion happens at the edge.

alter table public.country_configs
  add column platform_fee_bps int not null default 700;

-- Upper bound is a fat-finger guard, not a policy: at 10000 the seller receives
-- nothing. The lower bound matters more than it looks — Paystack's own fee
-- comes out of SnapDuka's share, so a rate at or below Paystack's effective
-- rate (~1.95% in Ghana) means SnapDuka pays to process each sale. 100 bps is
-- a floor low enough to allow a deliberate promotional rate while making an
-- accidental 0 impossible.
alter table public.country_configs
  add constraint country_configs_platform_fee_bps_check
  check (platform_fee_bps between 100 and 3000);

comment on column public.country_configs.platform_fee_bps is
  'SnapDuka''s share of each online transaction, in basis points, sent to Paystack as subaccount percentage_charge. The seller receives (10000 - this) bps. Paystack''s own processing fee is deducted from SnapDuka''s share, not the seller''s.';

update public.country_configs set platform_fee_bps = 700, updated_at = now();

-- Records the rate a subaccount was actually created with. Paystack stores
-- percentage_charge on the subaccount at creation time, so changing the setting
-- above does NOT move existing sellers — they keep their old rate until their
-- subaccount is updated through the Paystack API. Without this column that
-- drift is invisible: nothing in the database would say which sellers are still
-- on 10% and which are on 7%.
alter table public.payment_subaccounts
  add column percentage_charge_bps int;

alter table public.payment_subaccounts
  add constraint payment_subaccounts_percentage_charge_bps_check
  check (percentage_charge_bps is null or percentage_charge_bps between 0 and 10000);

comment on column public.payment_subaccounts.percentage_charge_bps is
  'The fee this subaccount is actually on at Paystack. NULL means it predates this column and should be treated as unknown until reconciled against the provider.';
