"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor, type Actor, type SellerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { parseFulfillmentMethod } from "@/lib/fulfillment/schema";
import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/settings/fulfillment";

/**
 * Delivery and pickup options, and why a silent refusal here is worse than
 * elsewhere: with no fulfillment method configured, checkout has no way
 * forward at all. A seller whose method failed to save has a storefront that
 * takes no orders, and nothing on this page said so — the failures were logged
 * to a server console the seller cannot see.
 */
function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

const NOT_ALLOWED = "Your role does not allow changing shop settings.";
const NOT_ACTIVE = "Your account is not active, so delivery options cannot be changed.";

/** An assertion, matching assertCanChangePlan in settings/billing/actions.ts,
 *  so callers narrow to a seller without a dead `return` afterwards. */
function assertCanManageFulfillment(actor: Actor): asserts actor is SellerActor {
  if (actor.kind !== "seller") fail("Sign in as a seller to change delivery options.");
  if (!hasPermission(actor.role ?? "owner", "settings.manage")) fail(NOT_ALLOWED);
  if (!["pending", "active"].includes(actor.status)) fail(NOT_ACTIVE);
}

export async function saveFulfillmentMethod(formData: FormData) {
  const actor = await resolveServerActor();
  assertCanManageFulfillment(actor);

  const input = Object.fromEntries(["type", "name", "feeMinor", "instructions"].map((key) => [key, String(formData.get(key) ?? "")]));
  const parsed = parseFulfillmentMethod(input);
  if (!parsed.success) {
    // The field errors were logged and thrown away; the seller saw nothing.
    const first = Object.values(parsed.fieldErrors ?? {})[0]?.[0];
    fail(first ?? "Check the delivery option details and try again.");
  }
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("seller_account_id", actor.sellerAccountId).single();
  if (!shop) fail("Create your shop before adding delivery options.");
  const { error } = await supabase.from("fulfillment_methods").insert({
    shop_id: shop.id,
    seller_account_id: actor.sellerAccountId,
    type: parsed.data.type,
    name: parsed.data.name,
    fee_minor: parsed.data.feeMinor,
    instructions: parsed.data.instructions,
  });
  if (error) fail("That delivery option could not be saved.");

  revalidatePath(PATH);
  revalidatePath("/onboarding");
  redirect(`${PATH}?saved=added`);
}

export async function updateFulfillmentFee(formData: FormData) {
  const actor = await resolveServerActor();
  assertCanManageFulfillment(actor);

  const methodId = String(formData.get("methodId") ?? "");
  const fee = String(formData.get("feeMinor") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!methodId) fail("That delivery option could not be identified.");
  if (!/^\d+$/.test(fee)) fail("Enter the fee as a whole number, with no symbols.");
  if (name.length < 2) fail("Give this delivery option a name buyers will recognise.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fulfillment_methods")
    .update({ fee_minor: Number(fee), name })
    .eq("id", methodId)
    .eq("seller_account_id", actor.sellerAccountId);
  if (error) fail("That delivery option could not be updated.");

  revalidatePath(PATH);
  redirect(`${PATH}?saved=updated`);
}

export async function toggleFulfillmentMethod(formData: FormData) {
  const actor = await resolveServerActor();
  assertCanManageFulfillment(actor);

  const methodId = String(formData.get("methodId") ?? "");
  const active = formData.get("active") === "true";
  if (!methodId) fail("That delivery option could not be identified.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fulfillment_methods")
    .update({ active })
    .eq("id", methodId)
    .eq("seller_account_id", actor.sellerAccountId);
  if (error) fail("That delivery option could not be changed.");

  revalidatePath(PATH);
  redirect(`${PATH}?saved=${active ? "enabled" : "disabled"}`);
}
