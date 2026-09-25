"use server";

import { createListingDraft, type ListingDraftResult } from "@/lib/ai/listing-draft";
import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Web entry point for Snap-to-list: the photo the seller just picked in the
 * product form, already resized to 1000px JPEG in the browser, goes to the
 * vision model and comes back as a draft that prefills the form.
 *
 * Returns the draft and nothing else. It writes no product — the seller reads
 * the draft, edits it and presses the form's own Save, which is the only path
 * to a listing.
 */
export async function draftListingFromPhotoAction(input: { dataUrl: string }): Promise<ListingDraftResult> {
  const actor = await resolveServerActor();
  // kind alone proves nothing: a team member resolves as kind "seller" with the
  // owner's account id, so the role is checked too.
  if (
    actor.kind !== "seller" ||
    !hasPermission(actor.role ?? "owner", "products.manage") ||
    !["pending", "active"].includes(actor.status)
  ) {
    return { ok: false, reason: "not_enabled", message: "Your role does not allow creating products." };
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl ?? "");
  if (!match) return { ok: false, reason: "invalid_image", message: "Use a JPEG, PNG or WebP photo." };

  const limited = await checkRateLimit(`web:ai.listing-draft:${actor.sellerAccountId}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return { ok: false, reason: "failed", message: "Too many drafts in a minute. Try again shortly." };
  }

  return createListingDraft({
    sellerAccountId: actor.sellerAccountId,
    image: { kind: "base64", data: match[2], mediaType: match[1] },
  });
}
