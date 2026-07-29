"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export async function updateCreatorProfile(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "creator") return;

  const displayName = String(formData.get("displayName") ?? "").trim();
  const contactPhone = String(formData.get("contactPhone") ?? "").replace(/[\s()-]/g, "");
  const momoName = String(formData.get("momoName") ?? "").trim();

  const fail = (message: string): never =>
    redirect(`/creator/settings?error=${encodeURIComponent(message)}`);

  if (!displayName) fail("Enter the name shops will see.");
  if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhone)) {
    fail("Enter your phone in international format, starting with +.");
  }

  const supabase = await createClient();
  // Handle is intentionally immutable: it is how a shop identifies the person
  // they agreed a rate with, and letting it change mid-partnership invites
  // impersonation.
  const { error } = await supabase
    .from("creators")
    .update({
      display_name: displayName,
      contact_phone: contactPhone,
      payout_details: momoName ? { momoName } : {},
    })
    .eq("id", actor.creatorId);

  if (error) fail("Those details could not be saved.");

  revalidatePath("/creator/settings");
  redirect("/creator/settings?message=Saved");
}
