"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveCreatorContext } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

/**
 * The creator's half of "mark as paid". SnapDuka records a seller's assertion
 * that money moved; this is the only corroboration available, so it is part of
 * the record rather than a nicety.
 */
export async function respondToPayment(formData: FormData): Promise<void> {
  const creator = await resolveCreatorContext();
  // Gated on the creator profile so a shop owner promoting another shop
  // qualifies. Returning silently left the form looking broken; sign-in is the
  // actual next step.
  if (!creator) redirect(`/login?next=/creator/payments`);

  const paymentId = String(formData.get("paymentId") ?? "");
  const action = String(formData.get("action") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_creator_commission_payment", {
    p_payment_id: paymentId,
    p_action: action,
    p_note: note || undefined,
  });

  if (error) {
    redirect(`/creator/payments?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/creator/payments");
  revalidatePath("/creator");
  redirect(
    `/creator/payments?message=${encodeURIComponent(
      action === "confirm" ? "Thanks — payment confirmed." : "The shop has been told.",
    )}`,
  );
}
