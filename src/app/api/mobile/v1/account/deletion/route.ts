import { z } from "zod";

import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Start deleting a seller account, from inside the app.
 *
 * App Store guideline 5.1.1(v) requires this path to exist for any app that
 * lets someone create an account. There was none.
 *
 * What happens immediately is what the seller is asking for and entitled to:
 * the shop is unpublished and the account closed, so nothing more can be sold
 * through it. Erasure of personal data follows on the retention schedule,
 * because orders, ledger entries and creator commissions are records of
 * transactions involving other people — buyers owed receipts, creators owed
 * money, a platform with tax obligations — and cascading them away on a tap
 * would destroy the other side of each one. The app says so rather than
 * implying everything vanishes instantly.
 *
 * Only the account owner may do this: a team member closing the shop they work
 * for would be an obvious way to cause damage.
 */

const schema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  const actor = await requireSeller("settings.manage");
  if (isResponse(actor)) return actor;

  if (actor.role) {
    return fail("forbidden", "Only the account owner can close this account.");
  }

  const limited = await enforceRateLimit("account.deletion", actor.sellerAccountId, {
    limit: 3,
    windowMs: 24 * 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("account_deletion_requests")
      .select("id, requested_at")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("status", "requested")
      .maybeSingle();

    if (existing) {
      // Not an error: a seller tapping twice should be reassured, not scolded.
      return ok({ requested: true, requestedAt: existing.requested_at });
    }

    const { data: created, error } = await admin
      .from("account_deletion_requests")
      .insert({
        seller_account_id: actor.sellerAccountId,
        auth_user_id: actor.userId,
        reason: body.reason ?? null,
      })
      .select("id, requested_at")
      .single();
    if (error || !created) return failUnexpected("account.deletion", error);

    // Take the storefront down first. If a later step fails, the shop being
    // closed is the safe end state — a live shop taking orders for an account
    // being deleted is not.
    const { error: shopError } = await admin
      .from("shops")
      .update({ status: "closed", unpublished_at: new Date().toISOString() })
      .eq("seller_account_id", actor.sellerAccountId);
    if (shopError) console.error("[account.deletion] could not unpublish", shopError.message);

    const { error: accountError } = await admin
      .from("seller_accounts")
      .update({ status: "closed", is_active: false })
      .eq("id", actor.sellerAccountId);
    if (accountError) return failUnexpected("account.deletion", accountError);

    // Creators stop earning on a shop that no longer sells.
    await admin
      .from("creator_partnerships")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("seller_account_id", actor.sellerAccountId)
      .in("status", ["invited", "active", "paused"]);

    return ok({ requested: true, requestedAt: created.requested_at }, 201);
  } catch (error) {
    return failUnexpected("account.deletion", error);
  }
}
