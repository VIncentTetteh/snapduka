import "server-only";

import { FLAG_KEYS, type FlagKey, type FlagSnapshot } from "@snapduka/core";

import type { CountryCode } from "@snapduka/core";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side feature flag evaluation. Resolution rules live in SQL
 * (`evaluate_feature_flag`, 202609250102) so the database, workers and web all
 * agree; this is a thin typed wrapper.
 *
 * Fails closed: if the flag cannot be read, the feature is off. Every flag
 * guards something new, and "new thing silently on because the lookup broke"
 * is the failure we cannot afford for money features.
 */
export async function isFeatureEnabled(
  key: FlagKey,
  scope: { sellerAccountId?: string | null; country?: CountryCode | null } = {},
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("evaluate_feature_flag", {
    p_key: key,
    p_seller_account_id: scope.sellerAccountId ?? undefined,
    p_country: scope.country ?? undefined,
  });
  if (error) {
    console.error(`[flags] could not evaluate ${key}; treating as off`, error);
    return false;
  }
  return data === true;
}

/** Every static flag for one seller, for shipping to a client in one round trip. */
export async function flagSnapshot(sellerAccountId: string): Promise<FlagSnapshot> {
  const values = await Promise.all(
    FLAG_KEYS.map((key) => isFeatureEnabled(key, { sellerAccountId })),
  );
  return Object.fromEntries(FLAG_KEYS.map((key, i) => [key, values[i]]));
}
