import { createApiKey } from "@/lib/api-keys/keys";
import { getSellerPlan, planLimit, withinPlanLimit } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

/**
 * Issuing an API key.
 *
 * The plaintext token exists exactly once, in the return value of this
 * function: only a peppered hash is stored, so a key that is not copied at that
 * moment is gone. That is why this cannot happen on a device — the pepper is
 * server-only and the hash has to be computed where it lives.
 *
 * Shared by the web action and the mobile route so the scope allow-list and the
 * plan limit are enforced in one place.
 */

export const API_KEY_SCOPES = [
  "products:read",
  "orders:read",
  "customers:read",
  "fulfillment:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export type IssueApiKeyResult =
  /** The only time the plaintext token is ever available. */
  | { ok: true; token: string }
  | { ok: false; reason: "config" | "invalid" | "plan_limit" | "failed"; message: string };

export type IssueApiKeyInput = { name?: string | null; scopes: string[] };

export async function issueApiKey(
  actor: { sellerAccountId: string },
  input: IssueApiKeyInput,
): Promise<IssueApiKeyResult> {
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper) {
    return { ok: false, reason: "config", message: "API key generation is not configured." };
  }

  const scopes = input.scopes
    .map(String)
    .filter((scope): scope is ApiKeyScope =>
      (API_KEY_SCOPES as readonly string[]).includes(scope),
    );
  if (!scopes.length) {
    return { ok: false, reason: "invalid", message: "Select at least one scope." };
  }

  const supabase = await createClient();
  const [plan, { count: keyCount }] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .is("revoked_at", null),
  ]);

  if (!withinPlanLimit(plan, "apiKeys", keyCount ?? 0)) {
    const limit = planLimit(plan, "apiKeys");
    return {
      ok: false,
      reason: "plan_limit",
      message:
        limit === 0
          ? `API access is not included in the ${plan.planName} plan. Upgrade in Settings → Plan & billing.`
          : `Your ${plan.planName} plan includes ${limit} API keys. Revoke one or upgrade to add more.`,
    };
  }

  const key = createApiKey(pepper);
  const { error } = await supabase.from("api_keys").insert({
    id: key.id,
    seller_account_id: actor.sellerAccountId,
    name: input.name?.trim() || "API key",
    key_prefix: key.prefix,
    key_hash: key.hash,
    scopes,
  });

  if (error) return { ok: false, reason: "failed", message: "Could not create key." };
  return { ok: true, token: key.token };
}
