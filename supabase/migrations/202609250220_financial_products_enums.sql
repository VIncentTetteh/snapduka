-- Ledger account kinds for stock financing and promoted listings (ADR-0014).
--
-- In their own migration because a value added with ALTER TYPE ... ADD VALUE
-- cannot be used in the transaction that adds it (same split as
-- 202609250104_protect_enums.sql).
--
-- Every one of these is credit-normal under ledger_account_for's default, which
-- is what each of them is:

-- Liability, seller-owned: money swept from a seller's releases towards their
-- stock-financing advance and held for the lending partner until remitted.
-- SnapDuka owes it to the partner; it is on the seller's account so the sweep
-- and the remittance are attributable per seller and per advance.
alter type public.ledger_account_kind add value if not exists 'financing_payable';

-- Platform clearing with the lending partner: the NET amount SnapDuka owes the
-- partner. Negative while a disbursement has been credited to a seller but the
-- partner's cash has not yet been recorded as landing; positive once swept
-- repayments have been remitted but not yet transferred. Zero means "settled
-- with the partner". Credit-normal so a positive balance reads as "we owe them".
alter type public.ledger_account_kind add value if not exists 'partner_clearing';

-- Income: SnapDuka's contractual share of the partner's financing fee, if the
-- partner agreement grants one (financing_policies.platform_fee_share_bps,
-- default 0). SnapDuka never charges its own interest: it does not lend.
alter type public.ledger_account_kind add value if not exists 'financing_fee_revenue';

-- Liability, seller-owned: prepaid promoted-listing budget. Funded from the
-- seller's available balance, spent click by click, withdrawable back.
alter type public.ledger_account_kind add value if not exists 'ads_prepaid';

-- Income: billed promoted-listing clicks.
alter type public.ledger_account_kind add value if not exists 'ads_revenue';
