"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

/** Marks all of the seller's in-app notifications as read. */
export async function markNotificationsReadAction(): Promise<void> {
  const actor = await resolveServerActor();
  // Nobody but a seller has in-app notifications, so there is genuinely nothing
  // to do here — this is a no-op, not a refused request.
  if (actor.kind !== "seller") return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("channel", "in_app")
    .is("read_at", null);
  // Not worth interrupting the seller over, but a badge that will not clear
  // should leave a trace somewhere.
  if (error) {
    console.error("[markNotificationsReadAction] could not mark notifications read", { error });
  }

  revalidatePath("/dashboard", "layout");
}
