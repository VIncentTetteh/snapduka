import "server-only";

import { z } from "zod";

import type { CountryCode, CurrencyCode } from "@snapduka/core";

import { writeAuditEvent } from "@/lib/audit/write";
import { getFinancingPartner, type FinancingPartnerEvent } from "@/lib/financing/partner";
import { FINANCING_TERMS_VERSION } from "@/lib/financing/terms";
import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stock financing, seller side and partner side (ADR-0014). Every money rule
 * lives in SQL (202609250221); this module decides who may call which function
 * and talks to the partner adapter. It reads through the service-role client,
 * so every query names the seller explicitly: RLS is not behind it.
 */

const eligibilitySchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  country: z.string(),
  currency: z.enum(["GHS", "NGN", "XOF"]),
  partner: z.string(),
  gmv90dMinor: z.number(),
  orders90d: z.number(),
  refundRateBps: z.number(),
  chargebackRateBps: z.number(),
  trustTier: z.string().nullable(),
  verified: z.boolean(),
  accountAgeDays: z.number(),
});

export type FinancingEligibility = z.infer<typeof eligibilitySchema>;

export type FinancingOfferView = {
  id: string;
  currency: CurrencyCode;
  principalMinor: number;
  feeBps: number;
  feeMinor: number;
  totalRepayableMinor: number;
  sweepBps: number;
  termsVersion: string;
  expiresAt: string;
};

export type FinancingAdvanceView = {
  id: string;
  state: string;
  currency: CurrencyCode;
  principalMinor: number;
  feeMinor: number;
  totalRepayableMinor: number;
  sweepBps: number;
  sweptMinor: number;
  acceptedAt: string;
  disbursedAt: string | null;
  repaidAt: string | null;
  closedAt: string | null;
};

export type CapitalOverview =
  | { enabled: false }
  | {
      enabled: true;
      /** False until a lending partner is contracted for the market. */
      partnerReady: boolean;
      eligibility: FinancingEligibility;
      offer: FinancingOfferView | null;
      advances: FinancingAdvanceView[];
    };

const LIVE_STATES = new Set(["accepted", "disbursed", "repaying"]);

/** The live advance (awaiting funding or repaying), if any. */
export function liveAdvance(advances: FinancingAdvanceView[]): FinancingAdvanceView | null {
  return advances.find((advance) => LIVE_STATES.has(advance.state)) ?? null;
}

type AdvanceRow = {
  id: string;
  state: string;
  currency: CurrencyCode;
  principal_minor: number;
  fee_minor: number;
  total_repayable_minor: number;
  sweep_bps: number;
  swept_minor: number;
  accepted_at: string;
  disbursed_at: string | null;
  repaid_at: string | null;
  closed_at: string | null;
};

function toAdvanceView(row: AdvanceRow): FinancingAdvanceView {
  return {
    id: row.id,
    state: row.state,
    currency: row.currency,
    principalMinor: row.principal_minor,
    feeMinor: row.fee_minor,
    totalRepayableMinor: row.total_repayable_minor,
    sweepBps: row.sweep_bps,
    sweptMinor: row.swept_minor,
    acceptedAt: row.accepted_at,
    disbursedAt: row.disbursed_at,
    repaidAt: row.repaid_at,
    closedAt: row.closed_at,
  };
}

const ADVANCE_COLUMNS =
  "id,state,currency,principal_minor,fee_minor,total_repayable_minor,sweep_bps,swept_minor,accepted_at,disbursed_at,repaid_at,closed_at";

/**
 * Everything the Capital screen shows. Mints an offer when the seller
 * qualifies and a partner can fund it; an offer the partner cannot fund would
 * be a promise nobody can keep.
 */
export async function getCapitalOverview(input: {
  sellerAccountId: string;
  country: CountryCode;
}): Promise<CapitalOverview> {
  if (!(await isFeatureEnabled("stock_financing", { sellerAccountId: input.sellerAccountId }))) {
    return { enabled: false };
  }
  const admin = createAdminClient();

  const { data: raw, error } = await admin.rpc("financing_eligibility", {
    p_seller_account_id: input.sellerAccountId,
  });
  if (error) throw new Error(`financing_eligibility failed: ${error.message}`);
  const eligibility = eligibilitySchema.parse(raw);
  const partnerReady = getFinancingPartner(eligibility.partner).status() === "ready";

  let offer: FinancingOfferView | null = null;
  if (eligibility.eligible && partnerReady) {
    const { data: offerId, error: offerError } = await admin.rpc("create_financing_offer", {
      p_seller_account_id: input.sellerAccountId,
    });
    if (offerError) throw new Error(`create_financing_offer failed: ${offerError.message}`);
    if (offerId) {
      const { data: row } = await admin
        .from("financing_offers")
        .select("id,currency,principal_minor,fee_bps,fee_minor,total_repayable_minor,sweep_bps,terms_version,expires_at")
        .eq("id", offerId)
        .eq("seller_account_id", input.sellerAccountId)
        .maybeSingle();
      if (row) {
        offer = {
          id: row.id,
          currency: row.currency,
          principalMinor: row.principal_minor,
          feeBps: row.fee_bps,
          feeMinor: row.fee_minor,
          totalRepayableMinor: row.total_repayable_minor,
          sweepBps: row.sweep_bps,
          termsVersion: row.terms_version,
          expiresAt: row.expires_at,
        };
      }
    }
  }

  const { data: advances, error: advanceError } = await admin
    .from("financing_advances")
    .select(ADVANCE_COLUMNS)
    .eq("seller_account_id", input.sellerAccountId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (advanceError) throw new Error(`financing_advances read failed: ${advanceError.message}`);

  return {
    enabled: true,
    partnerReady,
    eligibility,
    offer,
    advances: (advances ?? []).map(toAdvanceView),
  };
}

export type AcceptOfferResult =
  | { ok: true; advanceId: string; state: "disbursed" | "awaiting_partner" }
  | { ok: false; reason: "disabled" | "not_found" | "not_configured" | "refused" | "declined"; message: string };

/**
 * The seller accepts an offer. The acceptance is recorded first (so the seller
 * has a record of agreeing), then the partner is asked to fund it:
 *
 *   funded    -> disbursement posted; the money is in the seller's balance
 *   pending   -> the partner's webhook will say (advance.funded / declined)
 *   declined  -> the advance is cancelled; no money moved
 *   error     -> left in 'accepted'. Never cancelled on a network error: the
 *                partner may have funded it, and its webhook must still land.
 */
export async function acceptFinancingOffer(input: {
  sellerAccountId: string;
  userId: string;
  offerId: string;
  expectedTotalMinor: number;
  termsVersion: string;
}): Promise<AcceptOfferResult> {
  if (!(await isFeatureEnabled("stock_financing", { sellerAccountId: input.sellerAccountId }))) {
    return { ok: false, reason: "disabled", message: "Capital is not available for your shop yet." };
  }
  // The seller can only have read the terms text this build renders. An offer
  // minted under a newer policy version needs the newer text deployed first.
  if (input.termsVersion !== FINANCING_TERMS_VERSION) {
    return { ok: false, reason: "refused", message: "These terms are being updated. Try again shortly." };
  }
  const admin = createAdminClient();
  const { data: offer } = await admin
    .from("financing_offers")
    .select("id,partner,country")
    .eq("id", input.offerId)
    .eq("seller_account_id", input.sellerAccountId)
    .maybeSingle();
  if (!offer) return { ok: false, reason: "not_found", message: "That offer was not found." };

  const partner = getFinancingPartner(offer.partner);
  if (partner.status() !== "ready") {
    return { ok: false, reason: "not_configured", message: "Financing is not available in your market yet." };
  }

  const { data: advanceId, error } = await admin.rpc("accept_financing_offer", {
    p_offer_id: input.offerId,
    p_seller_account_id: input.sellerAccountId,
    p_accepted_by: input.userId,
    p_expected_total_minor: input.expectedTotalMinor,
    p_terms_version: input.termsVersion,
  });
  // The function raises with messages written for the seller.
  if (error || !advanceId) {
    return { ok: false, reason: "refused", message: error?.message ?? "The offer could not be accepted." };
  }

  await writeAuditEvent(admin, {
    actorType: "seller",
    actorId: input.userId,
    action: "financing.offer_accepted",
    entityType: "financing_advance",
    entityId: advanceId,
    after: { offerId: input.offerId, expectedTotalMinor: input.expectedTotalMinor, termsVersion: input.termsVersion },
  });

  const { data: advance } = await admin
    .from("financing_advances")
    .select("id,seller_account_id,country,currency,principal_minor,fee_minor,total_repayable_minor")
    .eq("id", advanceId)
    .single();
  if (!advance) return { ok: true, advanceId, state: "awaiting_partner" };

  let decision;
  try {
    decision = await partner.requestDisbursement({
      advanceId,
      sellerAccountId: advance.seller_account_id,
      country: advance.country,
      currency: advance.currency,
      principalMinor: advance.principal_minor,
      feeMinor: advance.fee_minor,
      totalRepayableMinor: advance.total_repayable_minor,
    });
  } catch (partnerError) {
    console.error(
      `[financing] disbursement request for ${advanceId} failed; left awaiting the partner`,
      partnerError instanceof Error ? partnerError.message : partnerError,
    );
    return { ok: true, advanceId, state: "awaiting_partner" };
  }

  if (decision.status === "declined") {
    const { error: cancelError } = await admin.rpc("cancel_financing_advance", {
      p_advance_id: advanceId,
      p_reason: decision.reason,
    });
    if (cancelError) console.error(`[financing] could not cancel declined advance ${advanceId}`, cancelError.message);
    return { ok: false, reason: "declined", message: "Our lending partner could not approve this advance." };
  }
  if (decision.status === "pending") return { ok: true, advanceId, state: "awaiting_partner" };

  const { error: disburseError } = await admin.rpc("record_financing_disbursement", {
    p_advance_id: advanceId,
    p_partner_reference: decision.partnerReference,
  });
  if (disburseError) {
    // The partner says it sent money we could not book. Loud, and the
    // partner's webhook replay (or an operator) books it; nothing is lost.
    console.error(`[financing] partner funded ${advanceId} but the disbursement did not post`, disburseError.message);
    return { ok: true, advanceId, state: "awaiting_partner" };
  }
  return { ok: true, advanceId, state: "disbursed" };
}

/**
 * Applies one verified partner webhook event. Idempotent: every function it
 * calls is. The advance must belong to the partner whose URL delivered the
 * event, so one partner's credentials can never move another partner's money.
 */
export async function applyFinancingPartnerEvent(
  partnerId: string,
  event: FinancingPartnerEvent,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();

  if (event.type === "funding.settled") {
    const { data, error } = await admin.rpc("record_partner_settlement", {
      p_currency: event.currency,
      p_direction: "from_partner",
      p_amount_minor: event.amountMinor,
      p_reference: `${partnerId}:${event.reference}`,
    });
    if (error) throw new Error(`record_partner_settlement failed: ${error.message}`);
    return { applied: data !== null };
  }

  const { data: advance } = await admin
    .from("financing_advances")
    .select("id,partner,state")
    .eq("id", event.advanceId)
    .maybeSingle();
  if (!advance || advance.partner !== partnerId) return { applied: false };

  if (event.type === "advance.funded") {
    if (advance.state !== "accepted") return { applied: false };
    const { error } = await admin.rpc("record_financing_disbursement", {
      p_advance_id: advance.id,
      p_partner_reference: event.partnerReference,
    });
    if (error) throw new Error(`record_financing_disbursement failed: ${error.message}`);
    return { applied: true };
  }
  if (event.type === "advance.declined") {
    if (advance.state !== "accepted") return { applied: false };
    const { error } = await admin.rpc("cancel_financing_advance", { p_advance_id: advance.id, p_reason: event.reason });
    if (error) throw new Error(`cancel_financing_advance failed: ${error.message}`);
    return { applied: true };
  }
  if (advance.state !== "disbursed" && advance.state !== "repaying") return { applied: false };
  const { error } = await admin.rpc("close_financing_advance", {
    p_advance_id: advance.id,
    p_state: event.type === "advance.defaulted" ? "defaulted" : "written_off",
    p_reason: event.reason,
  });
  if (error) throw new Error(`close_financing_advance failed: ${error.message}`);
  return { applied: true };
}

export type SettleOutcome = {
  currency: CurrencyCode;
  dueMinor: number;
  status: "sent" | "nothing_due" | "not_configured" | "ambiguous_partner" | "failed";
};

/**
 * Pays each currency's lending partner what SnapDuka has remitted to them and
 * not yet transferred, then records the transfer.
 *
 * Call, then record — and the reference is the cumulative total transferred
 * after this payment, so a crash between the two re-runs with the SAME
 * reference: the partner dedupes it and the record lands on the retry.
 */
export async function settleWithPartners(): Promise<SettleOutcome[]> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin.rpc("financing_partner_amounts_due");
  if (error) throw new Error(`financing_partner_amounts_due failed: ${error.message}`);

  const outcomes: SettleOutcome[] = [];
  for (const row of rows ?? []) {
    const due = row.due_minor;
    if (due <= 0) {
      outcomes.push({ currency: row.currency, dueMinor: due, status: "nothing_due" });
      continue;
    }
    if (row.partners !== 1) {
      console.error(`[financing/settle] ${row.currency} has ${row.partners} partners; refusing to guess who to pay`);
      outcomes.push({ currency: row.currency, dueMinor: due, status: "ambiguous_partner" });
      continue;
    }
    const partner = getFinancingPartner(row.partner);
    if (partner.status() !== "ready") {
      outcomes.push({ currency: row.currency, dueMinor: due, status: "not_configured" });
      continue;
    }
    const reference = `rep-${row.currency}-${row.transferred_minor + due}`;
    try {
      const result = await partner.sendRepayment({ currency: row.currency, amountMinor: due, reference });
      if (result.status !== "sent") {
        console.error(`[financing/settle] ${row.currency} transfer refused: ${result.reason}`);
        outcomes.push({ currency: row.currency, dueMinor: due, status: "failed" });
        continue;
      }
    } catch (partnerError) {
      console.error(
        `[financing/settle] ${row.currency} transfer failed`,
        partnerError instanceof Error ? partnerError.message : partnerError,
      );
      outcomes.push({ currency: row.currency, dueMinor: due, status: "failed" });
      continue;
    }
    const { error: recordError } = await admin.rpc("record_partner_settlement", {
      p_currency: row.currency,
      p_direction: "to_partner",
      p_amount_minor: due,
      p_reference: `${row.partner}:${reference}`,
    });
    if (recordError) {
      console.error(`[financing/settle] ${row.currency} sent but not recorded; retry will re-send ${reference}`, recordError.message);
      outcomes.push({ currency: row.currency, dueMinor: due, status: "failed" });
      continue;
    }
    outcomes.push({ currency: row.currency, dueMinor: due, status: "sent" });
  }
  return outcomes;
}
