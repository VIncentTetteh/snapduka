import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Credentials for one courier call.
 *
 * A seller who connected their own courier business account has credentials in
 * `courier_connections`, held in Vault (202609250140) and readable only by the
 * service role. Everyone else books on SnapDuka's platform account, whose key
 * the adapter reads from env itself — so `null` here means "use the platform
 * account", not "no credentials".
 *
 * A read failure also yields null rather than throwing: the platform account is
 * a working fallback, and failing a buyer's quote because a seller-specific
 * lookup hiccuped would be the wrong trade.
 */
export async function loadCourierCredentials(
  sellerAccountId: string,
  courierId: string,
): Promise<Readonly<Record<string, string>> | null> {
  const { data, error } = await createAdminClient().rpc("courier_connection_credentials", {
    p_seller_account_id: sellerAccountId,
    p_provider: courierId,
  });
  if (error) {
    console.error(`[couriers] could not read ${courierId} credentials; using platform account`, error.message);
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") credentials[key] = value;
  }
  return Object.keys(credentials).length > 0 ? credentials : null;
}

/**
 * Store (or rotate) a seller's courier credentials. Server-only: the caller
 * must already have checked the actor is the account owner — this writes
 * through the service role and RLS is not behind it.
 */
export async function saveCourierCredentials(
  sellerAccountId: string,
  courierId: string,
  credentials: Record<string, string>,
): Promise<{ ok: true } | { ok: false }> {
  const { error } = await createAdminClient().rpc("set_courier_connection_credentials", {
    p_seller_account_id: sellerAccountId,
    p_provider: courierId,
    p_credentials: credentials,
  });
  if (error) {
    console.error(`[couriers] could not save ${courierId} credentials`, error.message);
    return { ok: false };
  }
  return { ok: true };
}
