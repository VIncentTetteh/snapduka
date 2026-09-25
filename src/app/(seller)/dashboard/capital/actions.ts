"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { acceptFinancingOffer } from "@/lib/financing/service";

export type CapitalActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const acceptSchema = z.object({
  offerId: z.uuid(),
  // The total the seller saw. accept_financing_offer refuses if the offer row
  // now says anything else, so a re-priced offer can never be accepted on the
  // strength of an old screen.
  expectedTotalMinor: z.coerce.number().int().positive(),
  termsVersion: z.string().trim().min(1).max(20),
});

/**
 * The seller agrees to an advance.
 *
 * Owner only. `resolveServerActor` returns `kind: "seller"` with the OWNER's
 * sellerAccountId for a team member (with `role` set), and acceptFinancingOffer
 * runs through the service-role client with the seller id it is handed — so this
 * check is the whole boundary between a team member and a debt in the owner's
 * name. `role` is tested explicitly as well as `billing.manage`, so widening the
 * permission matrix later cannot quietly let a manager take on borrowing.
 */
export async function acceptOfferAction(
  _previousState: CapitalActionState,
  formData: FormData,
): Promise<CapitalActionState> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return { status: "error", message: "Sign in again." };
  if (actor.role || !hasPermission(actor.role ?? "owner", "billing.manage")) {
    return { status: "error", message: "Only the account owner can accept an advance." };
  }

  // Agreement has to be an act, not a default: the box is `required` in the
  // form, and re-checked here because a form is only a suggestion.
  if (formData.get("confirm") !== "yes") {
    return { status: "error", message: "Tick the box to confirm you have read and accept the terms." };
  }

  const parsed = acceptSchema.safeParse({
    offerId: formData.get("offerId"),
    expectedTotalMinor: formData.get("expectedTotalMinor"),
    termsVersion: formData.get("termsVersion"),
  });
  if (!parsed.success) {
    return { status: "error", message: "This offer could not be read. Reload the page and try again." };
  }

  const result = await acceptFinancingOffer({
    sellerAccountId: actor.sellerAccountId,
    userId: actor.userId,
    offerId: parsed.data.offerId,
    expectedTotalMinor: parsed.data.expectedTotalMinor,
    termsVersion: parsed.data.termsVersion,
  });

  revalidatePath("/dashboard/capital");
  if (!result.ok) return { status: "error", message: result.message };
  return {
    status: "success",
    message:
      result.state === "disbursed"
        ? "Accepted. The money is in your SnapDuka balance."
        : "Accepted. We are waiting for our lending partner to send the money; this page updates when it arrives.",
  };
}
