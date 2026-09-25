-- Scale the Protect and instant-payout fee floors to each currency.
--
-- 202609250105 added the floors and caps as single column defaults written in
-- Ghana pesewas: minimum 100 (GH₵1), cap 2000 (GH₵20), instant minimum 100.
-- Every market took those numbers, so Nigeria's Protect fee was capped at ₦20
-- and floored at ₦1, and its instant withdrawals at ₦1 — and XOF, which has no
-- minor unit, read them as whole francs. Found while putting the real fees on
-- the landing page. Nothing is live in either market (protect_enabled and
-- payouts are off), so no order or payout was ever priced with these values.
--
-- Roughly equivalent amounts: GH₵1 ≈ ₦100 ≈ 50 XOF.

update public.country_configs
   set protect_fee_min_minor = 10000,        -- ₦100
       protect_fee_cap_minor = 200000,       -- ₦2,000
       instant_payout_fee_min_minor = 10000  -- ₦100
 where country = 'NG';

update public.country_configs
   set protect_fee_min_minor = 50,           -- 50 XOF
       protect_fee_cap_minor = 1000,         -- 1,000 XOF
       instant_payout_fee_min_minor = 50     -- 50 XOF
 where country = 'CI';
