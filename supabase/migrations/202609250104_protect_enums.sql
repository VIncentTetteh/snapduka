-- Enum values for SnapDuka Protect, in their own migration because a value
-- added with ALTER TYPE ... ADD VALUE cannot be used in the same transaction
-- that adds it (the same reason 20260613001600_cote_divoire_enums.sql is split
-- from its config).

-- Income: the buyer-paid Protect fee is SnapDuka's, not the seller's.
alter type public.ledger_account_kind add value if not exists 'protect_fee_revenue';
-- Liability: seller money set aside against an open card chargeback. Owned by
-- the seller (it is still theirs if the chargeback is won) but not withdrawable.
alter type public.ledger_account_kind add value if not exists 'seller_dispute_reserve';

create type public.protect_state as enum (
  'held',        -- paid; funds held; not yet dispatched
  'in_transit',  -- dispatched; buyer holds a delivery code
  'releasable',  -- delivery confirmed (or timed out); inspection window running
  'released',    -- seller credited as available
  'disputed',    -- buyer dispute open; settlement frozen
  'refunded',    -- resolved in the buyer's favour
  'cancelled'    -- never dispatched; order cancelled before delivery
);
