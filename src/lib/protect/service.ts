import { isProtectState, type ProtectState } from "@snapduka/core";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side reads and actions for SnapDuka Protect. The rules live in SQL
 * (202609250105-0109); these are typed wrappers so routes stay thin adapters.
 *
 * order_protections is service-role only because it carries the delivery code
 * hash, so every read here goes through the admin client and callers must have
 * already proven who they are (seller ownership, tracking token, rider token).
 */

export type ProtectionView = {
  orderId: string;
  state: ProtectState;
  dispatchedAt: string | null;
  deliveryConfirmedAt: string | null;
  confirmationMethod: string | null;
  autoReleaseAt: string | null;
  inspectionEndsAt: string | null;
  codeLocked: boolean;
};

const VIEW_COLUMNS =
  "order_id,state,dispatched_at,delivery_confirmed_at,confirmation_method,auto_release_at,inspection_ends_at,code_locked_until";

type ProtectionRow = {
  order_id: string;
  state: string;
  dispatched_at: string | null;
  delivery_confirmed_at: string | null;
  confirmation_method: string | null;
  auto_release_at: string | null;
  inspection_ends_at: string | null;
  code_locked_until: string | null;
};

function toView(row: ProtectionRow): ProtectionView | null {
  if (!isProtectState(row.state)) return null;
  return {
    orderId: row.order_id,
    state: row.state,
    dispatchedAt: row.dispatched_at,
    deliveryConfirmedAt: row.delivery_confirmed_at,
    confirmationMethod: row.confirmation_method,
    autoReleaseAt: row.auto_release_at,
    inspectionEndsAt: row.inspection_ends_at,
    codeLocked: Boolean(row.code_locked_until && new Date(row.code_locked_until) > new Date()),
  };
}

/** The protection on one order, for a caller that has already authorised access to it. */
export async function protectionForOrder(orderId: string): Promise<ProtectionView | null> {
  const { data } = await createAdminClient()
    .from("order_protections")
    .select(VIEW_COLUMNS)
    .eq("order_id", orderId)
    .maybeSingle();
  return data ? toView(data as ProtectionRow) : null;
}

/**
 * The seller's view of a protection, including the rider link to hand to
 * whoever carries the parcel. Scoped by seller: a protection is only returned
 * for an order this seller owns.
 */
export async function protectionForSeller(
  orderId: string,
  sellerAccountId: string,
): Promise<(ProtectionView & { riderToken: string }) | null> {
  const { data } = await createAdminClient()
    .from("order_protections")
    .select(`${VIEW_COLUMNS},rider_token`)
    .eq("order_id", orderId)
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();
  if (!data) return null;
  const view = toView(data as ProtectionRow);
  return view ? { ...view, riderToken: (data as { rider_token: string }).rider_token } : null;
}

/** Order + protection by the courier's rider token (the only thing the rider page knows). */
export async function protectionForRiderToken(
  riderToken: string,
): Promise<{ view: ProtectionView; reference: string; shopName: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("order_protections")
    .select(`${VIEW_COLUMNS},orders!inner(public_reference,shops(display_name))`)
    .eq("rider_token", riderToken)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as ProtectionRow & {
    orders: { public_reference: string; shops: { display_name: string } | null };
  };
  const view = toView(row);
  if (!view) return null;
  return { view, reference: row.orders.public_reference, shopName: row.orders.shops?.display_name ?? null };
}

export type OptInResult =
  | { ok: true; protectionMode: "protect" | "none"; protectFeeMinor: number; totalMinor: number }
  | { ok: false; message: string };

/** Buyer opting in or out before paying. SQL enforces market, seller mode, limits and timing. */
export async function setOrderProtection(
  orderId: string,
  trackingToken: string,
  enabled: boolean,
): Promise<OptInResult> {
  const { data, error } = await createAdminClient().rpc("set_order_protection", {
    p_order_id: orderId,
    p_tracking_token: trackingToken,
    p_enabled: enabled,
  });
  if (error) {
    // 55000/P0002 carry buyer-safe messages written in the SQL; anything else
    // is unexpected and must not leak internals.
    const safe = error.code === "55000" || error.code === "P0002";
    if (!safe) console.error("[protect] set_order_protection failed", error);
    return { ok: false, message: safe ? error.message : "Protect could not be updated. Try again." };
  }
  const result = data as { protectionMode: "protect" | "none"; protectFeeMinor: number; totalMinor: number };
  return { ok: true, ...result };
}

export type ConfirmMethod = "buyer_code" | "rider_code" | "buyer_tap" | "operator";
export type ConfirmOutcome =
  | "confirmed"
  | "invalid_code"
  | "locked"
  | "already_confirmed"
  | "not_in_transit"
  | "not_found";

export async function confirmDelivery(
  orderId: string,
  method: ConfirmMethod,
  code?: string,
): Promise<ConfirmOutcome> {
  const { data, error } = await createAdminClient().rpc("confirm_delivery", {
    p_order_id: orderId,
    // Ignored for buyer_tap/operator; an empty string fails the code check otherwise.
    p_code: code ?? "",
    p_method: method,
  });
  if (error) throw new Error(`confirm_delivery failed: ${error.message}`);
  return data as ConfirmOutcome;
}

/**
 * Rotates the buyer's delivery code and returns the new one. Only ever called
 * for a caller holding the buyer's tracking token: the plaintext is returned
 * straight to them and stored nowhere.
 */
export async function reissueDeliveryCode(orderId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("issue_delivery_code", { p_order_id: orderId });
  if (error) throw new Error(`issue_delivery_code failed: ${error.message}`);
  return (data as string | null) ?? null;
}

/** The seller's effective settlement mode (per-seller override, else country). */
export async function settlementModeFor(sellerAccountId: string): Promise<"subaccount" | "ledger"> {
  const { data, error } = await createAdminClient().rpc("seller_settlement_mode", {
    p_seller_account_id: sellerAccountId,
  });
  if (error) throw new Error(`seller_settlement_mode failed: ${error.message}`);
  return data === "ledger" ? "ledger" : "subaccount";
}
