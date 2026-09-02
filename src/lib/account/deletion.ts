import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type DeletionOutcome =
  | { ok: true; requestedAt: string; alreadyRequested: boolean }
  | { ok: false; message: string };

/**
 * Starts deleting a seller account.
 *
 * Shared by the mobile API route and the web settings action so the two cannot
 * drift: the whole point of this path is that it does the same irreversible
 * thing whichever surface asks for it.
 *
 * What happens immediately is what the seller is asking for and entitled to —
 * the shop is unpublished and the account closed, so nothing more can be sold
 * through it. Erasure of personal data follows on the retention schedule,
 * because orders, ledger entries and creator commissions are records of
 * transactions involving other people — buyers owed receipts, creators owed
 * money, a platform with tax obligations — and cascading them away on a tap
 * would destroy the other side of each one.
 *
 * Callers are responsible for checking the actor is the account OWNER: a team
 * member closing the shop they work for would be an obvious way to cause damage.
 */
export async function requestAccountDeletion(input: {
  sellerAccountId: string;
  userId: string;
  reason?: string | null;
}): Promise<DeletionOutcome> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("account_deletion_requests")
    .select("id, requested_at")
    .eq("seller_account_id", input.sellerAccountId)
    .eq("status", "requested")
    .maybeSingle();

  if (existing) {
    // Not an error: a seller asking twice should be reassured, not scolded.
    return { ok: true, requestedAt: existing.requested_at, alreadyRequested: true };
  }

  const { data: created, error } = await admin
    .from("account_deletion_requests")
    .insert({
      seller_account_id: input.sellerAccountId,
      auth_user_id: input.userId,
      reason: input.reason ?? null,
    })
    .select("id, requested_at")
    .single();
  if (error || !created) {
    console.error("[account.deletion] could not record the request", error);
    return { ok: false, message: "Could not start the deletion. Try again shortly." };
  }

  // Take the storefront down first. If a later step fails, the shop being closed
  // is the safe end state — a live shop taking orders for an account being
  // deleted is not.
  const { error: shopError } = await admin
    .from("shops")
    .update({ status: "closed", unpublished_at: new Date().toISOString() })
    .eq("seller_account_id", input.sellerAccountId);
  if (shopError) console.error("[account.deletion] could not unpublish", shopError.message);

  const { error: accountError } = await admin
    .from("seller_accounts")
    .update({ status: "closed", is_active: false })
    .eq("id", input.sellerAccountId);
  if (accountError) {
    console.error("[account.deletion] could not close the account", accountError);
    return { ok: false, message: "Could not close the account. Contact support." };
  }

  // Creators stop earning on a shop that no longer sells.
  await admin
    .from("creator_partnerships")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("seller_account_id", input.sellerAccountId)
    .in("status", ["invited", "active", "paused"]);

  return { ok: true, requestedAt: created.requested_at, alreadyRequested: false };
}
