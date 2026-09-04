"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * Creating and editing a campaign.
 *
 * Every refusal is spoken. The link-creation action on this page used to return
 * silently on all seven of its failure branches, which is how a token bug went
 * unnoticed long enough for production to accumulate zero links from it.
 */

const CAMPAIGNS_PATH = "/dashboard/growth/campaigns";

function fail(message: string, campaignId?: string): never {
  const path = campaignId ? `${CAMPAIGNS_PATH}/${campaignId}` : CAMPAIGNS_PATH;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const STATUSES = ["draft", "active", "paused", "ended"] as const;
type Status = (typeof STATUSES)[number];

/** Money in, minor units out. Blank is "not set", which is not the same as 0. */
function parseMoney(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function parseDate(raw: FormDataEntryValue | null): string | null {
  const text = String(raw ?? "").trim();
  return text || null;
}

async function requireCampaignManager() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to manage campaigns.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) {
    fail("Your role does not allow managing campaigns.");
  }
  return actor;
}

type CampaignFields = {
  name: string;
  objective: string | null;
  status: Status;
  starts_at: string | null;
  ends_at: string | null;
  budget_minor: number | null;
  spend_minor: number;
  notes: string | null;
};

function readFields(formData: FormData, campaignId?: string): CampaignFields {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) fail("Give the campaign a name.", campaignId);
  if (name.length > 120) fail("That name is too long — keep it under 120 characters.", campaignId);

  const statusInput = String(formData.get("status") ?? "draft");
  const status = STATUSES.find((candidate) => candidate === statusInput);
  if (!status) fail("Choose a status for the campaign.", campaignId);

  const startsAt = parseDate(formData.get("starts_at"));
  const endsAt = parseDate(formData.get("ends_at"));
  // The database enforces this too, but a CHECK violation would surface as
  // "campaign could not be saved" rather than telling the seller what to fix.
  if (startsAt && endsAt && endsAt < startsAt) {
    fail("The end date cannot be before the start date.", campaignId);
  }

  return {
    name,
    objective: String(formData.get("objective") ?? "").trim() || null,
    status,
    starts_at: startsAt,
    ends_at: endsAt,
    budget_minor: parseMoney(formData.get("budget")),
    spend_minor: parseMoney(formData.get("spend")) ?? 0,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createCampaignRecord(formData: FormData) {
  const actor = await requireCampaignManager();
  const fields = readFields(formData);

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) fail("Create your shop before starting a campaign.");

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({ ...fields, seller_account_id: actor.sellerAccountId, shop_id: shop.id })
    .select("id")
    .single();

  if (error || !campaign) fail("That campaign could not be created.");

  revalidatePath(CAMPAIGNS_PATH);
  redirect(`${CAMPAIGNS_PATH}/${campaign.id}`);
}

export async function updateCampaignRecord(formData: FormData) {
  await requireCampaignManager();
  const id = String(formData.get("campaignId") ?? "");
  if (!id) fail("That campaign could not be found.");

  const fields = readFields(formData, id);
  const supabase = await createClient();

  // No seller_account_id filter needed — campaigns_owner_all scopes the update,
  // and adding one here would imply the policy could not be trusted.
  const { error } = await supabase.from("campaigns").update(fields).eq("id", id);
  if (error) fail("Those changes could not be saved.", id);

  revalidatePath(CAMPAIGNS_PATH);
  revalidatePath(`${CAMPAIGNS_PATH}/${id}`);
  redirect(`${CAMPAIGNS_PATH}/${id}?saved=1`);
}

/**
 * Upload the campaign's creative.
 *
 * Mirrors `uploadShopLogoAction`: a data URL from the client, decoded here and
 * written under `{seller_account_id}/…`, which is what the storage RLS policy
 * scopes on. A unique filename per upload so a cached copy of the old creative
 * never lingers on a story card.
 */
export async function uploadCampaignCreative(
  campaignId: string,
  dataUrl: string,
): Promise<{ success: boolean; message: string }> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) {
    return { success: false, message: "Sign in with an account that can manage campaigns." };
  }

  const base64 = dataUrl.split(",")[1];
  if (!base64) return { success: false, message: "That image could not be read." };

  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id,creative_path")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { success: false, message: "That campaign could not be found." };

  const objectPath = `${actor.sellerAccountId}/campaign-${campaignId}-${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("campaign-media")
    .upload(objectPath, Buffer.from(base64, "base64"), {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (uploadError) return { success: false, message: "The image could not be uploaded." };

  const { error: saveError } = await supabase
    .from("campaigns")
    .update({ creative_path: objectPath })
    .eq("id", campaignId);
  if (saveError) {
    // Don't leave an orphan behind when the row write is the thing that failed.
    await supabase.storage.from("campaign-media").remove([objectPath]);
    return { success: false, message: "The image could not be saved." };
  }

  if (campaign.creative_path && campaign.creative_path !== objectPath) {
    await supabase.storage.from("campaign-media").remove([campaign.creative_path]);
  }

  revalidatePath(`${CAMPAIGNS_PATH}/${campaignId}`);
  return { success: true, message: "Creative saved." };
}

/** Replace the campaign's product selection wholesale. */
export async function setCampaignProducts(formData: FormData) {
  const actor = await requireCampaignManager();
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!campaignId) fail("That campaign could not be found.");

  const productIds = formData.getAll("productId").map(String).filter(Boolean);
  const supabase = await createClient();

  // The form only ever offers this seller's own products, but the ids arrive in
  // a POST body, so nothing stops a different one being submitted. Verify both
  // ends against the catalogue rather than trusting the request: the campaign is
  // theirs, and every product is theirs.
  //
  // campaign_products_product_same_seller would refuse a foreign product anyway,
  // but as a raw 23503 the seller would only see "could not be saved".
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!campaign) fail("That campaign could not be found.");

  if (productIds.length > 0) {
    const { data: owned } = await supabase
      .from("products")
      .select("id")
      .eq("seller_account_id", actor.sellerAccountId)
      .in("id", productIds);
    if ((owned?.length ?? 0) !== new Set(productIds).size) {
      fail("One of those products is no longer in your catalogue.", campaignId);
    }
  }

  const { error: clearError } = await supabase
    .from("campaign_products")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("seller_account_id", actor.sellerAccountId);
  if (clearError) fail("Those products could not be saved.", campaignId);

  if (productIds.length > 0) {
    const { error } = await supabase.from("campaign_products").insert(
      productIds.map((productId) => ({
        campaign_id: campaignId,
        product_id: productId,
        seller_account_id: actor.sellerAccountId,
      })),
    );
    if (error) fail("Those products could not be saved.", campaignId);
  }

  revalidatePath(`${CAMPAIGNS_PATH}/${campaignId}`);
  redirect(`${CAMPAIGNS_PATH}/${campaignId}?saved=1`);
}
