import "server-only";

import { resolveBuyerActor, type BuyerActor } from "@/lib/auth/actor";
import { isFeatureEnabled } from "@/lib/flags";
import { createRequestScopedClient } from "@/lib/supabase/request";

import { bootstrapBuyerProfile, claimGuestOrders, type BuyerClient } from "./account";

/**
 * Buyer accounts are one network, not a per-shop feature, so the flag is read
 * without a seller. The country scope lets a market rollout (`country_code =
 * GH`) switch it on; a global row does too. Ghana-only for now because the
 * consent text is written against Act 843.
 */
export const BUYER_HOME_COUNTRY = "GH" as const;

export async function isBuyerAccountsEnabled(sellerAccountId?: string | null): Promise<boolean> {
  return sellerAccountId
    ? isFeatureEnabled("buyer_accounts", { sellerAccountId })
    : isFeatureEnabled("buyer_accounts", { country: BUYER_HOME_COUNTRY });
}

export type BuyerSession =
  | { state: "disabled" }
  | { state: "anonymous" }
  /** Signed in, but not with a verified phone (e.g. a seller's email login). */
  | { state: "needs_phone" }
  /** The verified phone already belongs to another live buyer profile. */
  | { state: "phone_in_use" }
  | { state: "error" }
  | { state: "buyer"; buyer: BuyerActor; client: BuyerClient };

type Dependencies = {
  enabled: () => Promise<boolean>;
  resolve: typeof resolveBuyerActor;
  client: () => Promise<BuyerClient>;
  bootstrap: typeof bootstrapBuyerProfile;
  claim: typeof claimGuestOrders;
};

const defaults: Dependencies = {
  enabled: () => isBuyerAccountsEnabled(),
  resolve: resolveBuyerActor,
  client: createRequestScopedClient,
  bootstrap: bootstrapBuyerProfile,
  claim: claimGuestOrders,
};

/**
 * The buyer behind this request, provisioning the profile on first sign-in.
 *
 * Bootstrap runs here rather than in the OTP verify action so that any way a
 * buyer arrives signed in (web OTP, the mobile app, a session that predates
 * the flag) converges on the same idempotent path. A consented buyer's guest
 * orders are claimed on the same pass, so orders placed as a guest since the
 * last visit appear without a button press; the claim itself is idempotent.
 */
export async function getBuyerSession(
  options: Partial<Dependencies> & {
    /** Pages claim on load; API routes pass false so a JSON call stays read-only and cheap. */
    claimOnResolve?: boolean;
  } = {},
): Promise<BuyerSession> {
  const { claimOnResolve = true, ...deps } = options;
  const d = { ...defaults, ...deps };
  if (!(await d.enabled())) return { state: "disabled" };

  const client = await d.client();
  let actor = await d.resolve();
  if (actor.kind === "anonymous") return { state: "anonymous" };

  if (actor.kind === "unprovisioned") {
    const boot = await d.bootstrap(client);
    if (boot.status === "phone_unverified") return { state: "needs_phone" };
    if (boot.status === "phone_in_use") return { state: "phone_in_use" };
    if (boot.status === "error") return { state: "error" };
    actor = await d.resolve();
    if (actor.kind !== "buyer") return { state: "error" };
  }

  if (claimOnResolve && actor.consented) await d.claim(client);
  return { state: "buyer", buyer: actor, client };
}
