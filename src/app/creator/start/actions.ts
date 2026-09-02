"use server";

import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { safeNextPath } from "@/lib/auth/redirect";
import { COUNTRIES, oneOf } from "@/lib/db/enums";
import { createClient } from "@/lib/supabase/server";

/**
 * Creates the creator identity through the definer RPC. creators has no INSERT
 * policy on purpose, so this is the only way in — the caller can never choose
 * their own status or attach to another user's auth id.
 */
export async function createCreatorProfile(formData: FormData): Promise<never> {
  const actor = await resolveServerActor();
  if (!actor.authenticated) redirect("/login?next=/creator/start");

  const next = safeNextPath(String(formData.get("next") ?? "/creator"));
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const contactPhone = String(formData.get("contactPhone") ?? "").replace(/[\s()-]/g, "");
  const country = String(formData.get("country") ?? "GH");

  const fail = (message: string): never =>
    redirect(`/creator/start?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);

  if (!/^[a-z0-9][a-z0-9_]{2,29}$/.test(handle)) {
    fail("Handle must be 3-30 characters: lowercase letters, numbers and underscores.");
  }
  if (!displayName) fail("Enter the name shops will see.");
  if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhone)) {
    fail("Enter your phone in international format, starting with +.");
  }
  const creatorCountry = oneOf(country, COUNTRIES);
  if (!creatorCountry) fail("Choose a country.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("bootstrap_creator_account", {
    p_handle: handle,
    p_display_name: displayName,
    p_contact_phone: contactPhone,
    p_country: creatorCountry!,
    p_contact_email: actor.email ?? undefined,
  });

  if (error) {
    fail(error.message.includes("creators_handle_key") ? "That handle is taken." : "Profile could not be created.");
  }

  redirect(next);
}
