"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit/write";
import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Operator actions on stock financing (ADR-0014). Every rule — what can be
 * settled, which advances can close or cancel — lives in the SQL functions
 * (202609250221); these check the caller, shape the input, surface the
 * function's own refusal and write the audit trail. Refusals redirect back
 * with ?error=, following protect-actions.ts.
 */

const PATH = "/admin/capital";

function back(message: string, ok = false): never {
  redirect(`${PATH}?${ok ? "saved" : "error"}=${encodeURIComponent(message)}`);
}

/** Redirects a non-operator; the service-role client below has no RLS behind it. */
async function operatorId(): Promise<string> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect(`/login?next=${encodeURIComponent(PATH)}`);
  return actor.userId;
}

const currencySchema = z.enum(["GHS", "NGN", "XOF"]);
const idSchema = z.uuid();

/**
 * Records money moving between SnapDuka and a lending partner outside the
 * partner's webhook (e.g. a bank transfer reconciled by hand). The function
 * caps the running total at what is actually due in each direction and is
 * keyed on the reference, so a replay is a no-op rather than a second entry.
 */
export async function recordPartnerSettlementAction(formData: FormData) {
  const userId = await operatorId();

  const currency = currencySchema.safeParse(formData.get("currency"));
  const direction = formData.get("direction");
  const reference = String(formData.get("reference") ?? "").trim();
  const amount = Number.parseFloat(String(formData.get("amount") ?? ""));
  if (!currency.success) back("Choose a currency.");
  if (direction !== "from_partner" && direction !== "to_partner") back("Choose the direction of the transfer.");
  if (!Number.isFinite(amount) || amount <= 0) back("Enter the amount transferred.");
  if (!reference) back("Enter the bank or partner reference.");
  // XOF has no minor unit; everything else is 100 subunits.
  const amountMinor = Math.round(currency.data === "XOF" ? amount : amount * 100);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_partner_settlement", {
    p_currency: currency.data,
    p_direction: direction,
    p_amount_minor: amountMinor,
    p_reference: reference,
    p_recorded_by: userId,
  });
  if (error) back(error.message);
  if (!data) back("That reference is already recorded; nothing was added.");

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: userId,
    action: "financing.partner_settlement_recorded",
    entityType: "ledger_transaction",
    entityId: data,
    before: null,
    after: { currency: currency.data, direction, amountMinor },
    metadata: { reference },
  });

  revalidatePath(PATH);
  back("Settlement recorded.", true);
}

/**
 * The partner has declared an advance defaulted or written it off. Sweeping
 * stops; there is no ledger entry because the unpaid remainder is the
 * partner's debt, never SnapDuka's.
 */
export async function closeAdvanceAction(formData: FormData) {
  const userId = await operatorId();

  const advanceId = idSchema.safeParse(formData.get("advanceId"));
  const state = formData.get("state");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!advanceId.success) back("That advance was not found.");
  if (state !== "defaulted" && state !== "written_off") back("Choose defaulted or written off.");
  if (!reason) back("Record why the advance is being closed.");

  const admin = createAdminClient();
  const { error } = await admin.rpc("close_financing_advance", {
    p_advance_id: advanceId.data,
    p_state: state,
    p_reason: reason,
  });
  if (error) back(error.message);

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: userId,
    action: `financing.advance_${state}`,
    entityType: "financing_advance",
    entityId: advanceId.data,
    before: null,
    after: { state },
    metadata: { reason },
  });

  revalidatePath(PATH);
  back(state === "defaulted" ? "Advance marked defaulted." : "Advance written off.", true);
}

/**
 * Cancels an advance the partner never funded. The function only allows it
 * from 'accepted' (no money moved). Do not use this because a partner call
 * timed out: the partner may have funded it and its webhook must still land.
 */
export async function cancelAdvanceAction(formData: FormData) {
  const userId = await operatorId();

  const advanceId = idSchema.safeParse(formData.get("advanceId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!advanceId.success) back("That advance was not found.");
  if (!reason) back("Record why the advance is being cancelled.");

  const admin = createAdminClient();
  const { error } = await admin.rpc("cancel_financing_advance", {
    p_advance_id: advanceId.data,
    p_reason: reason,
  });
  if (error) back(error.message);

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: userId,
    action: "financing.advance_cancelled",
    entityType: "financing_advance",
    entityId: advanceId.data,
    before: { state: "accepted" },
    after: { state: "cancelled" },
    metadata: { reason },
  });

  revalidatePath(PATH);
  back("Advance cancelled.", true);
}
