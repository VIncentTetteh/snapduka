"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  claimGuestOrders,
  requestBuyerDeletion,
  setSharedProfileConsent,
  type BuyerClient,
} from "@/lib/buyer/account";
import { buyerAddressInputSchema, toAddressColumns } from "@/lib/buyer/addresses";
import { SHARED_PROFILE_CONSENT_VERSION } from "@/lib/buyer/consent";
import { getBuyerSession } from "@/lib/buyer/session";
import type { BuyerActor } from "@/lib/auth/actor";

/**
 * Server actions for the signed-in buyer. Each one re-resolves the buyer from
 * the verified session (never from a form field), and every write goes through
 * the buyer's own client so RLS is the boundary — the profile id in a hidden
 * input would be exactly the "trust the id the writer sent" mistake.
 */

type Page = "/me" | "/me/addresses" | "/me/privacy";

function to(page: Page, kind: "error" | "message", text: string): never {
  redirect(`${page}?${new URLSearchParams({ [kind]: text }).toString()}`);
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function requireBuyerSession(): Promise<{ buyer: BuyerActor; client: BuyerClient }> {
  const session = await getBuyerSession({ claimOnResolve: false });
  if (session.state === "disabled") redirect("/");
  if (session.state !== "buyer") redirect("/me");
  return { buyer: session.buyer, client: session.client };
}

// ── Consent ─────────────────────────────────────────────────────────────────

export async function grantConsentAction(formData: FormData): Promise<never> {
  const { client } = await requireBuyerSession();
  // The version shown on the page travels with the form; a stale tab showing
  // older wording must not record agreement to the current text.
  if (field(formData, "version") !== SHARED_PROFILE_CONSENT_VERSION) {
    to("/me/privacy", "error", "The consent text has changed. Please read it again.");
  }
  if (!(await setSharedProfileConsent(client, true, SHARED_PROFILE_CONSENT_VERSION))) {
    to("/me", "error", "We could not save your choice. Please try again.");
  }
  const claim = await claimGuestOrders(client);
  revalidatePath("/me", "layout");
  to(
    "/me",
    "message",
    claim.claimed > 0
      ? `Done. We found ${claim.claimed} earlier order${claim.claimed === 1 ? "" : "s"} placed with your number.`
      : "Done. Orders you place with this number will appear here.",
  );
}

export async function withdrawConsentAction(): Promise<never> {
  const { client } = await requireBuyerSession();
  if (!(await setSharedProfileConsent(client, false, SHARED_PROFILE_CONSENT_VERSION))) {
    to("/me/privacy", "error", "We could not save your choice. Please try again.");
  }
  revalidatePath("/me", "layout");
  to("/me/privacy", "message", "Consent withdrawn. Your orders are no longer linked to your profile.");
}

// ── Profile ─────────────────────────────────────────────────────────────────

const nameSchema = z.string().trim().min(1, "Enter your name.").max(120);

export async function updateDisplayNameAction(formData: FormData): Promise<never> {
  const { buyer, client } = await requireBuyerSession();
  const parsed = nameSchema.safeParse(field(formData, "displayName"));
  if (!parsed.success) to("/me", "error", parsed.error.issues[0].message);

  const { error } = await client
    .from("buyer_profiles")
    .update({ display_name: parsed.data })
    .eq("id", buyer.buyerProfileId);
  if (error) to("/me", "error", "We could not save your name.");
  revalidatePath("/me");
  to("/me", "message", "Saved.");
}

export async function deleteBuyerProfileAction(formData: FormData): Promise<never> {
  const { client } = await requireBuyerSession();
  if (field(formData, "confirm").trim().toUpperCase() !== "DELETE") {
    to("/me/privacy", "error", "Type DELETE to confirm.");
  }
  if (!(await requestBuyerDeletion(client, field(formData, "reason").trim() || null))) {
    to("/me/privacy", "error", "We could not delete your profile. Please try again or contact support.");
  }
  // The profile is gone; the auth user may still be a seller's login, so it is
  // signed out rather than deleted here.
  await client.auth.signOut();
  redirect("/me?message=Your+SnapDuka+buyer+profile+has+been+deleted.");
}

// ── Addresses ───────────────────────────────────────────────────────────────

function addressFromForm(formData: FormData) {
  const lat = field(formData, "lat");
  const lng = field(formData, "lng");
  return buyerAddressInputSchema.safeParse({
    label: field(formData, "label"),
    line1: field(formData, "line1"),
    area: field(formData, "area"),
    city: field(formData, "city"),
    region: field(formData, "region"),
    country: field(formData, "country") || "GH",
    digitalAddress: field(formData, "digitalAddress") || undefined,
    landmark: field(formData, "landmark"),
    lat: lat ? Number(lat) : undefined,
    lng: lng ? Number(lng) : undefined,
  });
}

const idSchema = z.uuid();

export async function saveAddressAction(formData: FormData): Promise<never> {
  const { buyer, client } = await requireBuyerSession();
  const parsed = addressFromForm(formData);
  if (!parsed.success) to("/me/addresses", "error", parsed.error.issues[0].message);

  const rawId = field(formData, "id");
  if (rawId) {
    const id = idSchema.safeParse(rawId);
    if (!id.success) to("/me/addresses", "error", "Address not found.");
    const { data, error } = await client
      .from("buyer_addresses")
      .update(toAddressColumns(parsed.data))
      .eq("id", id.data)
      .eq("buyer_profile_id", buyer.buyerProfileId)
      .select("id");
    if (error || !data?.length) to("/me/addresses", "error", "We could not save that address.");
  } else {
    const { error } = await client
      .from("buyer_addresses")
      .insert({ ...toAddressColumns(parsed.data), buyer_profile_id: buyer.buyerProfileId });
    if (error?.code === "54000") to("/me/addresses", "error", "You can save up to 20 addresses. Remove one first.");
    if (error) to("/me/addresses", "error", "We could not save that address.");
  }
  revalidatePath("/me/addresses");
  to("/me/addresses", "message", "Address saved.");
}

export async function deleteAddressAction(formData: FormData): Promise<never> {
  const { buyer, client } = await requireBuyerSession();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) to("/me/addresses", "error", "Address not found.");
  const { error } = await client
    .from("buyer_addresses")
    .delete()
    .eq("id", id.data)
    .eq("buyer_profile_id", buyer.buyerProfileId);
  if (error) to("/me/addresses", "error", "We could not remove that address.");
  revalidatePath("/me/addresses");
  to("/me/addresses", "message", "Address removed.");
}

export async function setDefaultAddressAction(formData: FormData): Promise<never> {
  const { buyer, client } = await requireBuyerSession();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) to("/me/addresses", "error", "Address not found.");
  // buyer_profiles_default_address_guard refuses an id that is not this
  // buyer's own, whatever the form says.
  const { error } = await client
    .from("buyer_profiles")
    .update({ default_address_id: id.data })
    .eq("id", buyer.buyerProfileId);
  if (error) to("/me/addresses", "error", "We could not set that as your default.");
  revalidatePath("/me/addresses");
  to("/me/addresses", "message", "Default address updated.");
}
