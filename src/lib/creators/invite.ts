import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { appOrigin } from "@/lib/app-url";
import { getSellerPlan, planAllows, planLimit, upgradeMessage } from "@/lib/billing/resolve";
import { MAX_RATE_BPS } from "@/lib/creators/commission";
import { sendEmail } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
import { createClient } from "@/lib/supabase/server";

/**
 * Inviting a creator to promote a shop.
 *
 * Server-side because of the token: the invitation link is a bearer credential
 * that binds a commission rate to whoever holds it, so only its SHA-256 hash is
 * stored and the plaintext exists just long enough to be sent. A device cannot
 * be trusted to do either, which is why the mobile app calls a route rather
 * than writing the row itself.
 *
 * The row is rolled back if delivery fails, so there is never an invitation
 * nobody was told about — pending invitations count against the plan's creator
 * seats, and a phantom one would quietly consume a seat forever.
 */

export type InviteCreatorFailure =
  | { reason: "plan"; message: string }
  | { reason: "seat_limit"; message: string }
  | { reason: "invalid"; field: "contact" | "ratePercent" | "holdDays"; message: string }
  | { reason: "failed"; message: string };

export type InviteCreatorResult = { ok: true } | ({ ok: false } & InviteCreatorFailure);

export type InviteCreatorInput = {
  contact: string;
  ratePercent: number;
  holdDays: number;
};

/** 14 days, matching what the acceptance page tells the creator. */
const INVITE_TTL_MS = 14 * 86_400_000;

export async function inviteCreator(
  actor: { sellerAccountId: string; userId: string },
  input: InviteCreatorInput,
): Promise<InviteCreatorResult> {
  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "creatorProgram")) {
    return { ok: false, reason: "plan", message: upgradeMessage("the creator program") };
  }

  const contact = input.contact.trim().toLowerCase();
  const isEmail = contact.includes("@");
  const contactValid = isEmail
    ? z.email().safeParse(contact).success
    : /^\+[1-9][0-9]{7,14}$/.test(contact.replace(/[\s()-]/g, ""));

  if (!contactValid) {
    return {
      ok: false,
      reason: "invalid",
      field: "contact",
      message: "Enter the creator's email address or phone number in international format.",
    };
  }
  if (
    !Number.isFinite(input.ratePercent) ||
    input.ratePercent <= 0 ||
    input.ratePercent > MAX_RATE_BPS / 100
  ) {
    return {
      ok: false,
      reason: "invalid",
      field: "ratePercent",
      message: `Commission must be between 0.01% and ${MAX_RATE_BPS / 100}%.`,
    };
  }
  if (!Number.isInteger(input.holdDays) || input.holdDays < 0 || input.holdDays > 90) {
    return {
      ok: false,
      reason: "invalid",
      field: "holdDays",
      message: "Hold period must be between 0 and 90 days.",
    };
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
    return {
      ok: false,
      reason: "seat_limit",
      message: `Your ${plan.planName} plan includes ${limit} creator${limit === 1 ? "" : "s"}. Upgrade in Settings → Plan & billing to work with more.`,
    };
  }

  const token = randomBytes(32).toString("hex");
  const { data: invite, error } = await supabase
    .from("creator_invitations")
    .insert({
      seller_account_id: actor.sellerAccountId,
      contact,
      contact_kind: isEmail ? "email" : "phone",
      rate_bps: Math.round(input.ratePercent * 100),
      hold_days: input.holdDays,
      token_hash: createHash("sha256").update(token).digest("hex"),
      invited_by: actor.userId,
      expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();

  if (error || !invite) {
    return { ok: false, reason: "failed", message: "That invitation could not be created." };
  }

  const origin = await appOrigin();
  if (!origin) {
    await supabase.from("creator_invitations").delete().eq("id", invite.id);
    return { ok: false, reason: "failed", message: "Application URL is not configured." };
  }

  const url = new URL(`/creator/invitations/${token}`, origin).toString();
  const message = `You have been invited to earn ${input.ratePercent}% commission promoting a SnapDuka shop. Accept here: ${url}`;

  try {
    const result = isEmail
      ? await sendEmail(contact, "You have been invited to earn commission on SnapDuka", message)
      : await sendSms(contact, message);
    if (!result.delivered) throw new Error(result.reason);
  } catch {
    // Roll the invite back rather than leaving a row nobody was told about.
    await supabase.from("creator_invitations").delete().eq("id", invite.id);
    return {
      ok: false,
      reason: "failed",
      message: "The invitation could not be delivered. Check the contact and try again.",
    };
  }

  return { ok: true };
}
