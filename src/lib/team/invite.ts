import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { appOrigin } from "@/lib/app-url";
import { getSellerPlan, planLimit } from "@/lib/billing/resolve";
import { TEAM_ROLES } from "@/lib/db/enums";
import { sendEmail } from "@/lib/notifications/email";
import { createClient } from "@/lib/supabase/server";

/**
 * Inviting a teammate.
 *
 * Server-side for the same reason creator invitations are: the link is a bearer
 * credential, so only its SHA-256 hash is stored and the plaintext exists just
 * long enough to be emailed. A device can do neither, which is why the mobile
 * app calls a route instead of writing the row itself — before this existed the
 * app sent the seller to the web dashboard, where they arrived with no session
 * and hit a login wall.
 *
 * The row is rolled back if the email fails, so there is never an invitation
 * nobody was told about quietly occupying a plan seat.
 */

export type TeamRole = (typeof TEAM_ROLES)[number];

export type InviteTeamMemberFailure =
  | { reason: "seat_limit"; message: string }
  | { reason: "invalid"; field: "email" | "role"; message: string }
  | { reason: "failed"; message: string };

export type InviteTeamMemberResult = { ok: true } | ({ ok: false } & InviteTeamMemberFailure);

export type InviteTeamMemberInput = { email: string; role: string };

/** 7 days, matching what the invitation email tells the recipient. */
const INVITE_TTL_MS = 7 * 86_400_000;

export async function inviteTeamMember(
  actor: { sellerAccountId: string; userId: string },
  input: InviteTeamMemberInput,
): Promise<InviteTeamMemberResult> {
  const email = input.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success) {
    return {
      ok: false,
      reason: "invalid",
      field: "email",
      message: "Enter a valid email address.",
    };
  }

  const role = TEAM_ROLES.find((candidate) => candidate === input.role);
  if (!role) {
    return { ok: false, reason: "invalid", field: "role", message: "Choose a role." };
  }

  const supabase = await createClient();
  // Seats are a plan entitlement: the owner, plus active members, plus invites
  // that are still open.
  const [plan, { count: members }, { count: invites }] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    supabase
      .from("team_memberships")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("active", true),
    supabase
      .from("team_invitations")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);

  const seatLimit = planLimit(plan, "staffAccounts");
  if (1 + (members ?? 0) + (invites ?? 0) >= seatLimit) {
    return {
      ok: false,
      reason: "seat_limit",
      message: `Your ${plan.planName} plan includes ${seatLimit} staff account${
        seatLimit === 1 ? " (the owner)" : "s"
      }. Upgrade in Settings → Plan & billing to invite more.`,
    };
  }

  const token = randomBytes(32).toString("hex");
  const { data: invite, error } = await supabase
    .from("team_invitations")
    .insert({
      seller_account_id: actor.sellerAccountId,
      email,
      role,
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
    await supabase.from("team_invitations").delete().eq("id", invite.id);
    return { ok: false, reason: "failed", message: "Application URL is not configured." };
  }

  const invitationUrl = new URL(`/team/invitations/${token}`, origin).toString();

  try {
    const result = await sendEmail(
      email,
      "You were invited to a SnapDuka team",
      `Sign in with ${email} to accept the ${role} role: ${invitationUrl}\n\nThis invitation expires in 7 days.`,
    );
    if (!result.delivered) throw new Error(result.reason);
  } catch {
    // Roll back rather than leave a row nobody was told about.
    await supabase.from("team_invitations").delete().eq("id", invite.id);
    return {
      ok: false,
      reason: "failed",
      message: "The invitation email could not be sent. Check the address and try again.",
    };
  }

  return { ok: true };
}
