"use server";

import { createHash, randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planAllows, planLimit, upgradeMessage } from "@/lib/billing/resolve";
import { generateCampaignToken, isUniqueViolation } from "@/lib/campaigns/tokens";
import { MAX_RATE_BPS } from "@/lib/creators/commission";
import { sendEmail } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
import { createClient } from "@/lib/supabase/server";

const BASE = "/dashboard/creators";

function back(kind: "error" | "message", text: string, path = BASE): never {
  redirect(`${path}?${kind}=${encodeURIComponent(text)}`);
}

/** Owner or a team member with campaign rights; never a creator or operator. */
async function sellerContext() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) {
    return null;
  }
  return actor;
}

export async function inviteCreator(formData: FormData): Promise<void> {
  const actor = await sellerContext();
  if (!actor) return;

  const plan = await getSellerPlan(actor.sellerAccountId);
  // Fails loudly rather than with a bare return: the seller should learn why
  // nothing happened, following products/actions.ts rather than the silent
  // gates elsewhere.
  if (!planAllows(plan, "creatorProgram")) {
    back("error", upgradeMessage("the creator program"));
  }

  const contact = String(formData.get("contact") ?? "").trim().toLowerCase();
  const ratePercent = Number(formData.get("ratePercent"));
  const holdDays = Number(formData.get("holdDays") ?? 14);

  const isEmail = contact.includes("@");
  const contactValid = isEmail
    ? z.email().safeParse(contact).success
    : /^\+[1-9][0-9]{7,14}$/.test(contact.replace(/[\s()-]/g, ""));
  if (!contactValid) {
    back("error", "Enter the creator's email address or phone number in international format.");
  }
  if (!Number.isFinite(ratePercent) || ratePercent <= 0 || ratePercent > MAX_RATE_BPS / 100) {
    back("error", `Commission must be between 0.01% and ${MAX_RATE_BPS / 100}%.`);
  }
  if (!Number.isInteger(holdDays) || holdDays < 0 || holdDays > 90) {
    back("error", "Hold period must be between 0 and 90 days.");
  }

  const supabase = await createClient();
  const [{ count: partnerships }, { count: pending }] = await Promise.all([
    supabase
      .from("creator_partnerships")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .in("status", ["invited", "active", "paused"]),
    supabase
      .from("creator_invitations")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);

  const limit = planLimit(plan, "creatorPartnerships");
  if ((partnerships ?? 0) + (pending ?? 0) >= limit) {
    back(
      "error",
      `Your ${plan.planName} plan includes ${limit} creator${limit === 1 ? "" : "s"}. Upgrade in Settings → Plan & billing to work with more.`,
    );
  }

  const token = randomBytes(32).toString("hex");
  const { data: invite, error } = await supabase
    .from("creator_invitations")
    .insert({
      seller_account_id: actor.sellerAccountId,
      contact,
      contact_kind: isEmail ? "email" : "phone",
      rate_bps: Math.round(ratePercent * 100),
      hold_days: holdDays,
      token_hash: createHash("sha256").update(token).digest("hex"),
      invited_by: actor.userId,
      expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    })
    .select("id")
    .single();

  if (error || !invite) back("error", "That invitation could not be created.");

  const origin = await appOrigin();
  if (!origin) {
    await supabase.from("creator_invitations").delete().eq("id", invite.id);
    back("error", "Application URL is not configured.");
  }

  const url = new URL(`/creator/invitations/${token}`, origin).toString();
  const message = `You have been invited to earn ${ratePercent}% commission promoting a SnapDuka shop. Accept here: ${url}`;

  try {
    const result = isEmail
      ? await sendEmail(contact, "You have been invited to earn commission on SnapDuka", message)
      : await sendSms(contact, message);
    if (!result.delivered) throw new Error(result.reason);
  } catch {
    // Roll the invite back rather than leaving a row nobody was told about.
    await supabase.from("creator_invitations").delete().eq("id", invite.id);
    back("error", "The invitation could not be delivered. Check the contact and try again.");
  }

  back("message", "Invitation sent.");
}

export async function revokeCreatorInvitation(formData: FormData): Promise<void> {
  const actor = await sellerContext();
  if (!actor) return;
  const supabase = await createClient();
  await supabase
    .from("creator_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", String(formData.get("invitationId")))
    .eq("seller_account_id", actor.sellerAccountId)
    .is("accepted_at", null);
  revalidatePath(BASE);
}

export async function updatePartnership(formData: FormData): Promise<void> {
  const actor = await sellerContext();
  if (!actor) return;

  const partnershipId = String(formData.get("partnershipId"));
  const intent = String(formData.get("intent"));
  const supabase = await createClient();

  if (intent === "rate") {
    const ratePercent = Number(formData.get("ratePercent"));
    if (!Number.isFinite(ratePercent) || ratePercent <= 0 || ratePercent > MAX_RATE_BPS / 100) {
      back("error", `Commission must be between 0.01% and ${MAX_RATE_BPS / 100}%.`);
    }
    // Only affects future orders — existing commissions snapshot their rate.
    await supabase
      .from("creator_partnerships")
      .update({ rate_bps: Math.round(ratePercent * 100) })
      .eq("id", partnershipId)
      .eq("seller_account_id", actor.sellerAccountId);
  } else if (intent === "pause" || intent === "resume") {
    await supabase
      .from("creator_partnerships")
      .update({ status: intent === "pause" ? "paused" : "active" })
      .eq("id", partnershipId)
      .eq("seller_account_id", actor.sellerAccountId)
      .in("status", ["active", "paused"]);
  } else if (intent === "end") {
    await supabase
      .from("creator_partnerships")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", partnershipId)
      .eq("seller_account_id", actor.sellerAccountId);
  }

  revalidatePath(BASE);
  revalidatePath(`${BASE}/${partnershipId}`);
}

/** Creates the creator's own tracked link into this shop. */
export async function createCreatorLink(formData: FormData): Promise<void> {
  const actor = await sellerContext();
  if (!actor) return;
  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "creatorProgram")) back("error", upgradeMessage("the creator program"));

  const partnershipId = String(formData.get("partnershipId"));
  const supabase = await createClient();

  const [{ data: partnership }, { data: shop }] = await Promise.all([
    supabase
      .from("creator_partnerships")
      .select("id,creators(display_name)")
      .eq("id", partnershipId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase.from("shops").select("id,slug").eq("seller_account_id", actor.sellerAccountId).maybeSingle(),
  ]);
  if (!partnership || !shop) back("error", "That creator is no longer connected to your shop.");

  const creatorName =
    (partnership.creators as unknown as { display_name?: string } | null)?.display_name ?? "Creator";

  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from("campaign_links").insert({
      seller_account_id: actor.sellerAccountId,
      shop_id: shop.id,
      name: `${creatorName} · creator link`,
      token: generateCampaignToken(8),
      channel: "other",
      destination_path: `/${shop.slug}`,
      creator_partnership_id: partnershipId,
      active: true,
    });
    if (!error) break;
    if (!isUniqueViolation(error)) back("error", "That link could not be created.");
  }

  revalidatePath(`${BASE}/${partnershipId}`);
}

/**
 * Records that the seller paid the creator. SnapDuka moves no money here — the
 * RPC is the sole write path into the ledger and rejects the whole batch if any
 * commission is not payable, so a partial payment cannot be logged as a full one.
 */
export async function markCommissionsPaid(formData: FormData): Promise<void> {
  const actor = await sellerContext();
  if (!actor) return;

  const partnershipId = String(formData.get("partnershipId"));
  const creatorId = String(formData.get("creatorId"));
  const method = String(formData.get("method") ?? "mobile_money");
  const commissionIds = formData.getAll("commissionIds").map(String).filter(Boolean);
  const detail = `${BASE}/${partnershipId}`;

  if (commissionIds.length === 0) {
    back("error", "Select at least one commission to mark as paid.", detail);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_creator_commission_payment", {
    p_creator_id: creatorId,
    p_commission_ids: commissionIds,
    p_method: method,
    p_external_reference: String(formData.get("externalReference") ?? "").trim() || undefined,
    p_note: String(formData.get("note") ?? "").trim() || undefined,
  });

  if (error) back("error", error.message, detail);

  revalidatePath(detail);
  back("message", "Payment recorded. The creator has been notified.", detail);
}
