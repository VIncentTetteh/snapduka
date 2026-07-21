-- supabase/migrations/202607210038_revoke_direct_stock_rpc_access.sql
-- reserve_product_stock has no ownership check by design (a buyer
-- legitimately reserves stock on a product they don't own, via
-- create_guest_order) — the actual bug was that it was directly callable
-- via PostgREST RPC by ANY authenticated user, letting a malicious seller
-- lock a competitor's stock indefinitely by calling it directly against a
-- rival's product_id. create_guest_order has the same problem: it's meant
-- to be called only via create_guest_order_growth (which adds promotion/
-- campaign handling and is the route the rate-limited checkout endpoint
-- actually calls), but its own direct grant let a caller bypass both the
-- promo wrapper and the Next.js route's rate limiting entirely.
--
-- Revoking the caller-role grant here does not affect internal calls —
-- create_guest_order_growth and create_guest_order both run as their
-- definer (the migration-owning role), which always has implicit execute
-- on functions it owns regardless of what's granted to authenticated/anon.

revoke execute on function public.reserve_product_stock(uuid, uuid, integer, text, timestamptz) from authenticated;
revoke execute on function public.create_guest_order(uuid, uuid, jsonb, jsonb, text, text) from anon, authenticated;
