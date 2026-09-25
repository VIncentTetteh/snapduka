-- Creator-owned ledger accounts: the enum values, alone.
--
-- A value added with ALTER TYPE ... ADD VALUE cannot be used in the transaction
-- that adds it, and 202609250201 uses these in a check constraint and in
-- functions — the same reason 202609250104_protect_enums.sql is split from its
-- schema.
--
-- Three liabilities, mirroring the seller trio exactly (ADR-0001: pending,
-- available and reserved are separate ACCOUNTS, not a status column):
--
--   creator_pending          owed to a creator, still inside a hold
--   creator_available        owed to a creator and withdrawable
--   creator_payout_reserved  owed to a creator, committed to a withdrawal in flight

alter type public.ledger_account_kind add value if not exists 'creator_pending';
alter type public.ledger_account_kind add value if not exists 'creator_available';
alter type public.ledger_account_kind add value if not exists 'creator_payout_reserved';
