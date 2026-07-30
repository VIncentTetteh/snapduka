"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

/**
 * The creator's half of "mark as paid". SnapDuka records a seller's assertion
 * that money moved; this is the only corroboration available, so it is part of
 * the record rather than a nicety.
 */
export async function respondToPayment(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "creator") return;

  const paymentId = String(formData.get("paymentId") ?? "");
  const action = String(formData.get("action") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_creator_commission_payment", {
    p_payment_id: paymentId,
    p_action: action,
    p_note: note || null,
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
