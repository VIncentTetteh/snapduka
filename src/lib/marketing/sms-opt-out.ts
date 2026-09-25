import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import type { SmsKeywordAction } from "./sms-keywords";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Server side of SMS opt-out. The rules themselves live in SQL
 * (`sms_apply_opt_keyword`, migration 202609250260) so the inbound webhook and
 * the operator action cannot disagree about what a STOP does.
 *
 * Only marketing SMS consult this. Transactional SMS — order updates, OTPs,
 * delivery codes — go through `sendSms` directly and are never suppressed.
 */

export type ApplyOptKeywordResult =
  | { ok: true; duplicate: boolean; optedOut: boolean; consentsWithdrawn: number }
  | { ok: false; error: string };

export async function applySmsOptKeyword(
  admin: AdminClient,
  input: {
    phone: string;
    action: SmsKeywordAction;
    source: "inbound_sms" | "operator";
    keyword?: string | null;
    provider?: string | null;
    providerMessageId?: string | null;
    actorUserId?: string | null;
  },
): Promise<ApplyOptKeywordResult> {
  const { data, error } = await admin.rpc("sms_apply_opt_keyword", {
    p_phone: input.phone,
    p_action: input.action,
    p_source: input.source,
    p_keyword: input.keyword ?? undefined,
    p_provider: input.provider ?? undefined,
    p_provider_message_id: input.providerMessageId ?? undefined,
    p_actor: input.actorUserId ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
  const row = data?.[0];
  if (!row) return { ok: false, error: "no_result" };
  return { ok: true, duplicate: row.duplicate, optedOut: row.opted_out, consentsWithdrawn: row.consents_withdrawn };
}

/** Kept well under db.max_rows (1000), which would otherwise truncate silently. */
export const SUPPRESSION_BATCH = 500;

/**
 * Which of these phones must not receive marketing SMS. Throws on a failed
 * lookup: the caller must not treat "could not check" as "nobody opted out".
 */
export async function suppressedSmsPhones(admin: AdminClient, phones: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(phones)];
  const suppressed = new Set<string>();
  for (let start = 0; start < unique.length; start += SUPPRESSION_BATCH) {
    const batch = unique.slice(start, start + SUPPRESSION_BATCH);
    const { data, error } = await admin.rpc("sms_suppressed_phones", { p_phones: batch });
    if (error) throw new Error(`sms suppression lookup failed: ${error.message}`);
    for (const row of data ?? []) suppressed.add(row.phone);
  }
  return suppressed;
}

/** How many of a seller's customers an SMS broadcast will skip. Null if unknown. */
export async function sellerSmsSuppressedCount(admin: AdminClient, sellerAccountId: string): Promise<number | null> {
  const { data, error } = await admin.rpc("seller_sms_suppressed_count", { p_seller_account_id: sellerAccountId });
  if (error) {
    console.error("[sms-opt-out] suppressed count failed", { code: error.code, message: error.message });
    return null;
  }
  return data ?? 0;
}
