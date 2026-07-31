-- Removes three tables that were built, secured, tested — and never used.
--
--   seller_entitlements         0 rows, 0 references in src/
--   feature_usage               0 rows, 0 references in src/
--   settlement_reconciliations  0 rows, 0 references in src/
--
-- seller_entitlements was the original design: snapshot a plan's entitlements
-- onto each seller at subscribe time. Billing was later rebuilt around
-- versioned plans.entitlements resolved live (src/lib/billing/resolve.ts), with
-- seller_subscriptions.plan_version pinning the version — which achieves the
-- same immutability without a per-seller copy to keep in sync. The snapshot
-- table was left behind rather than removed.
--
-- feature_usage was intended for metered limits. Every gate in the product is
-- boolean or resolved by counting the real rows (products, staff seats), so
-- nothing ever wrote to it.
--
-- settlement_reconciliations was intended to reconcile Paystack settlements
-- against orders. That reconciliation was never built, and the payouts rework
-- established that SnapDuka never holds seller funds, so there is no SnapDuka
-- ledger to reconcile against — Paystack settles the seller's subaccount to
-- their bank directly.
--
-- Empty tables are not free: they carry RLS policies, grants and constraints
-- that every future schema change and security review has to reason about, and
-- they imply behaviour to anyone reading the schema that the code does not
-- have. payout_requests is deliberately NOT dropped here — it is also empty,
-- but it backs the operator review screen and is the foundation for a real
-- disbursement flow.

drop table if exists public.seller_entitlements;
drop table if exists public.feature_usage;
drop table if exists public.settlement_reconciliations;
