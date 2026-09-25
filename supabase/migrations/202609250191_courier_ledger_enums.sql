-- Ledger kinds for deliveries SnapDuka books on its own courier account. Split
-- from their use for the same ADD VALUE reason as 202609250104.

-- Liability: what SnapDuka owes couriers for bookings on its platform account.
alter type public.ledger_account_kind add value if not exists 'courier_payable';
-- Income: SnapDuka's margin on those bookings (country_configs.delivery_margin_bps).
alter type public.ledger_account_kind add value if not exists 'delivery_margin_revenue';
