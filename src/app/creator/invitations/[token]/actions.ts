"use server";

import { createHash } from "node:crypto";

import { redirect } from "next/navigation";

import { resolveCreatorContext, resolveServerActor } from "@/lib/auth/actor";
import { enqueueCreatorNotification } from "@/lib/notifications/enqueue";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Accepts a creator invitation and opens the partnership.
 *
 * Runs with the admin client because the invitation row belongs to the seller
 * and the creator has no read access to it — the hashed token is the
 * credential, exactly as in the team invitation flow.
 */
export async function acceptCreatorInvitation(formData: FormData): Promise<never> {
  const token = String(formData.get("token") ?? "");
  const actor = await resolveServerActor();

  if (!actor.authenticated || actor.kind === "operator") {
    redirect(`/login?next=/creator/invitations/${token}`);
  }
  // No profile yet: make one, then come back and accept. Resolved from the
  // creator row rather than the actor kind, because a shop owner accepting
  // another shop's invite still resolves as a seller.
  const creator = await resolveCreatorContext();
  if (!creator) {
    redirect(`/creator/start?next=${encodeURIComponent(`/creator/invitations/${token}`)}`);
  }

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("creator_invitations")
    .select("id,seller_account_id,rate_bps,hold_days")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!invite) redirect(`/creator/invitations/${token}?error=expired`);

  const { data: shop } = await admin
    .from("shops")
    .select("currency")
    .eq("seller_account_id", invite.seller_account_id)
    .maybeSingle();

  const { error } = await admin.from("creator_partnerships").upsert(
    {
      seller_account_id: invite.seller_account_id,
      creator_id: creator.creatorId,
      status: "active",
      rate_bps: invite.rate_bps,
      hold_days: invite.hold_days,
      currency: shop?.currency ?? "GHS",
      accepted_at: new Date().toISOString(),
    },
    { onConflict: "seller_account_id,creator_id" },
  );

  // The arms-length trigger raises here if the creator is the seller or their
  // staff, which is the one failure worth naming rather than swallowing.
  if (error) redirect(`/creator/invitations/${token}?error=blocked`);

  await admin
    .from("creator_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("accepted_at", null);

  // Confirms to the creator which shop they just joined and points at the one
  // thing they should do next. Nothing used to acknowledge an accepted
  // invitation at all, so the first act of the relationship was silence.
  const { data: shopName } = await admin
    .from("shops")
    .select("display_name")
    .eq("seller_account_id", invite.seller_account_id)
    .maybeSingle();

  await enqueueCreatorNotification(admin, {
    creatorId: creator.creatorId,
    sellerAccountId: invite.seller_account_id,
    event: "creator_partnership_accepted",
    shopName: shopName?.display_name ?? "A SnapDuka shop",
    dedupeKey: `${invite.seller_account_id}:${creator.creatorId}`,
  });

  redirect("/creator");
}

export async function declineCreatorInvitation(formData: FormData): Promise<never> {
  const token = String(formData.get("token") ?? "");
  const admin = createAdminClient();
  await admin
    .from("creator_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .is("accepted_at", null);
  redirect("/");
}
