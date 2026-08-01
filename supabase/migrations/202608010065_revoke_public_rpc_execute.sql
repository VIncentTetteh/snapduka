-- Closes a live hole: anon could mark orders paid without paying.
--
-- Postgres grants EXECUTE to PUBLIC when a function is created. Our migrations
-- wrote `grant execute ... to service_role` but never `revoke ... from public`,
-- so anon and authenticated kept EXECUTE by inheritance — and PostgREST exposes
-- every one of them at /rest/v1/rpc/<name>, reachable with the publishable key
-- that ships in the browser.
--
-- THE EXPLOIT (apply_paystack_success, the severe one):
--
--   1. Start a real checkout. The initialize response hands the buyer their own
--      payment_attempts.reference.
--   2. POST /rest/v1/rpc/apply_paystack_success with that reference and a
--      hand-written payload:
--        {"data":{"status":"success","amount":<order total>,"currency":"GHS"}}
--   3. The RPC's only defence compares the payload against the order — and the
--      caller supplies the payload. The order flips to paid, stock is consumed,
--      the seller is notified. Nothing was paid.
--
-- 202607210038_revoke_direct_stock_rpc_access.sql found this exact class on
-- 2026-07-21 and fixed it partially: it revoked reserve_product_stock from
-- authenticated but not anon, missed the create_guest_order_growth wrapper, and
-- never covered the payment RPCs. This completes that work.
--
-- Revoking is safe for every internal call. As that migration already noted:
-- SECURITY DEFINER functions execute as their owner, which holds implicit
-- EXECUTE on functions it owns, so nested calls (create_guest_order_growth ->
-- create_guest_order -> reserve_product_stock, triggers -> accrue_creator_
-- commission) are unaffected by these grants. Verified caller-by-caller: every
-- function below is invoked either from the service-role client or from SQL.

-- ---------------------------------------------------------------------------
-- 1. Service-role only. Each is called exclusively via createAdminClient().
-- ---------------------------------------------------------------------------
revoke execute on function
  public.apply_paystack_success(text, text, jsonb),
  public.apply_paystack_refund_event(text, text, text, jsonb),
  public.finalize_order_stock(uuid, text),
  public.finish_stock_reservation(uuid, text),
  public.enqueue_order_notification(uuid, text),
  public.check_rate_limit(text, integer, bigint),
  public.create_guest_order_growth(uuid, uuid, jsonb, jsonb, text, text, text, text, uuid)
from public, anon, authenticated;

-- Already revoked from authenticated in 202607210038; anon was missed.
revoke execute on function
  public.reserve_product_stock(uuid, uuid, integer, text, timestamptz)
from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions. They dereference NEW/OLD and are meaningless outside a
--    trigger, but they should not be part of the public API surface at all.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.accrue_creator_commission(),
  public.reverse_creator_commission(),
  public.assert_creator_partnership_arms_length(),
  public.apply_ledger_entry_to_balance(),
  public.assert_ledger_transaction_balanced(),
  public.prevent_ledger_mutation(),
  public.prevent_order_line_mutation(),
  public.stamp_order_fulfilled_at()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Genuinely called from a signed-in user's session. These keep
--    `authenticated` and lose `anon` — each authorises internally against
--    current_seller_account_id() / current_creator_id(), so a signed-in caller
--    can only act on their own rows, but an anonymous one has no business
--    reaching them at all.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.record_creator_commission_payment(uuid, uuid[], text, text, text),
  public.respond_to_creator_commission_payment(uuid, text, text),
  public.bootstrap_creator_account(text, text, text, public.country_code, text),
  public.refresh_discovery_listing(uuid)
from public, anon;

-- ---------------------------------------------------------------------------
-- 4. RLS helpers. Policies call these as the definer, so revoking the caller
--    grant does not affect policy evaluation — it only stops them being probed
--    directly through the REST API.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.current_creator_id(),
  public.team_has_role(uuid, public.team_role[])
from public, anon;

-- Re-assert the grants the app actually needs, in case a prior `grant ... to
-- PUBLIC` is what was carrying them.
grant execute on function
  public.apply_paystack_success(text, text, jsonb),
  public.apply_paystack_refund_event(text, text, text, jsonb),
  public.finalize_order_stock(uuid, text),
  public.finish_stock_reservation(uuid, text),
  public.enqueue_order_notification(uuid, text),
  public.check_rate_limit(text, integer, bigint),
  public.create_guest_order_growth(uuid, uuid, jsonb, jsonb, text, text, text, text, uuid),
  public.reserve_product_stock(uuid, uuid, integer, text, timestamptz)
to service_role;

grant execute on function
  public.record_creator_commission_payment(uuid, uuid[], text, text, text),
  public.respond_to_creator_commission_payment(uuid, text, text),
  public.bootstrap_creator_account(text, text, text, public.country_code, text),
  public.refresh_discovery_listing(uuid),
  public.current_creator_id(),
  public.team_has_role(uuid, public.team_role[])
to authenticated, service_role;
