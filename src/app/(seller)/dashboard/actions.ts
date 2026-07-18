"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

/** Marks all of the seller's in-app notifications as read. */
export async function markNotificationsReadAction(): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("channel", "in_app")
    .is("read_at", null);
  revalidatePath("/dashboard", "layout");
}
