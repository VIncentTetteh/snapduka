import "server-only";

import { resolveBuyerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";

import { isBuyerAccountsEnabled } from "./session";

export type LinkOutcome =
  | "linked"
  | "already_linked"
  | "skipped_disabled"
  | "skipped_no_buyer"
  | "skipped_no_consent"
  | "refused"
  | "failed";

type Dependencies = {
  enabled: (sellerAccountId: string) => Promise<boolean>;
  resolve: typeof resolveBuyerActor;
  link: (orderId: string, buyerProfileId: string) => Promise<{ status: string } | null>;
};

const defaults: Dependencies = {
  enabled: (sellerAccountId) => isBuyerAccountsEnabled(sellerAccountId),
  resolve: resolveBuyerActor,
  async link(orderId, buyerProfileId) {
    const { data, error } = await createAdminClient().rpc("link_order_to_buyer", {
      p_order_id: orderId,
      p_buyer_profile_id: buyerProfileId,
    });
    if (error) throw new Error(error.message);
    const status = data && typeof data === "object" && !Array.isArray(data) ? data.status : null;
    return typeof status === "string" ? { status } : null;
  },
};

/**
 * Attach a just-placed order to the signed-in buyer, if there is one.
 *
 * Runs AFTER create_guest_order* has committed and never throws: the order,
 * its totals, stock and payment are already settled, and nothing about a
 * buyer's history is worth telling them their order failed. A miss is
 * recoverable — claim_guest_orders() picks the order up on the next visit.
 *
 * The profile comes from the verified session, never the request body, and
 * link_order_to_buyer re-checks consent, age and phone on the database side,
 * because this call uses the service role and RLS will not catch a mistake.
 */
export async function linkCheckoutOrderToBuyer(
  orderId: string,
  sellerAccountId: string,
  deps: Partial<Dependencies> = {},
): Promise<LinkOutcome> {
  const d = { ...defaults, ...deps };
  try {
    if (!(await d.enabled(sellerAccountId))) return "skipped_disabled";

    const actor = await d.resolve();
    if (actor.kind !== "buyer") return "skipped_no_buyer";
    if (!actor.consented) return "skipped_no_consent";

    const result = await d.link(orderId, actor.buyerProfileId);
    if (result?.status === "linked") return "linked";
    if (result?.status === "already_linked") return "already_linked";
    return "refused";
  } catch (error) {
    console.error("[buyer] could not link checkout order", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}
