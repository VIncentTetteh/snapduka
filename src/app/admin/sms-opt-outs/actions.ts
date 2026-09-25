"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeAuditEvent } from "@/lib/audit/write";
import { requireOperator } from "@/lib/auth/require-operator";
import { normalizeSmsPhone } from "@/lib/marketing/sms-keywords";
import { applySmsOptKeyword } from "@/lib/marketing/sms-opt-out";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE = "/admin/sms-opt-outs";

function fail(message: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(message)}`);
}

/**
 * Opt a number out of marketing SMS by hand.
 *
 * For the buyer who phones support, emails, or replied STOP before inbound
 * keywords were wired up. It goes through the same SQL as an inbound STOP, so
 * it is platform-wide and withdraws every seller's marketing consent for the
 * number. There is deliberately no "opt back in" here: re-subscribing is the
 * buyer's act (START, or consent at a checkout), not an operator's.
 */
export async function addSmsOptOutAction(formData: FormData): Promise<void> {
  const actor = await requireOperator(PAGE);
  const phone = normalizeSmsPhone(String(formData.get("phone") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!phone) fail("Enter the number in international format, e.g. +233201234567.");
  if (!reason) fail("Record why the number is being opted out.");

  const admin = createAdminClient();
  const result = await applySmsOptKeyword(admin, {
    phone,
    action: "opt_out",
    source: "operator",
    actorUserId: actor.userId,
  });
  if (!result.ok) fail("That opt-out could not be saved. Nothing was changed.");

  // The phone is not written to the audit trail: it is a buyer's personal data,
  // and the opt-out row itself already records who applied it and when.
  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "sms_opt_out_added",
    entityType: "sms_opt_out",
    before: null,
    after: { reason, consentsWithdrawn: result.consentsWithdrawn },
    metadata: {},
  });

  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}
