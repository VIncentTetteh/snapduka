import "server-only";

import type { Json } from "@snapduka/core";

import {
  evaluateRiskRules,
  RISK_RULES_VERSION,
  type RiskContext,
  type RiskFacts,
  type RiskFinding,
} from "@/lib/risk/signals";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The I/O half of the risk engine: gather facts for a moment in the money
 * flow, run the rules (./signals.ts), and write what fires to risk_signals.
 *
 * Every fact is an exact head count or a single-row read — never rows counted
 * in JS, which db.max_rows would silently truncate for exactly the busy
 * sellers risk cares about most.
 *
 * Callers never await this on their critical path: see ./schedule.ts.
 */

type Admin = ReturnType<typeof createAdminClient>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function ago(ms: number, now: Date): string {
  return new Date(now.getTime() - ms).toISOString();
}

async function accountAgeDays(admin: Admin, sellerAccountId: string, now: Date): Promise<number | null> {
  const { data } = await admin
    .from("seller_accounts")
    .select("created_at")
    .eq("id", sellerAccountId)
    .maybeSingle();
  if (!data) return null;
  return (now.getTime() - Date.parse(data.created_at)) / DAY_MS;
}

/** Exact count, or 0 on error — a missing fact must not invent a finding. */
async function count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: value, error } = await query;
  return error ? 0 : (value ?? 0);
}

export async function recordRiskFindings(input: {
  sellerAccountId: string;
  context: RiskContext;
  /** The order / payout / check the findings are about; half of the dedupe key. */
  subjectId: string;
  findings: RiskFinding[];
}): Promise<number> {
  if (input.findings.length === 0) return 0;
  const rows = input.findings.map((finding) => ({
    seller_account_id: input.sellerAccountId,
    signal_type: finding.rule,
    score: finding.score,
    context: input.context,
    rules_version: RISK_RULES_VERSION,
    dedupe_key: `${finding.rule}:${input.subjectId}`,
    details: {
      ...finding.details,
      reason: finding.reason,
      subjectId: input.subjectId,
      shouldBlockLater: finding.shouldBlockLater,
    } satisfies Record<string, Json>,
  }));
  const { error } = await createAdminClient()
    .from("risk_signals")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) {
    console.error("[risk] could not record risk signals", error.message);
    return 0;
  }
  for (const finding of input.findings) {
    console.warn(`[risk] ${input.context} ${finding.rule} for seller ${input.sellerAccountId} (score ${finding.score})`);
  }
  return rows.length;
}

async function run(
  context: RiskContext,
  sellerAccountId: string,
  subjectId: string,
  facts: RiskFacts,
): Promise<RiskFinding[]> {
  const findings = evaluateRiskRules(context, facts);
  await recordRiskFindings({ sellerAccountId, context, subjectId, findings });
  return findings;
}

/** At Paystack initialisation, for an order already validated as payable. */
export async function assessCheckoutRisk(orderId: string, now = new Date()): Promise<RiskFinding[]> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id,seller_account_id,total_minor,currency,buyer_snapshot")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return [];

  const snapshot = order.buyer_snapshot;
  const email =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot.email === "string"
      ? snapshot.email
      : null;
  const hourAgo = ago(HOUR_MS, now);

  const [age, buyerOrders, sellerOrders] = await Promise.all([
    accountAgeDays(admin, order.seller_account_id, now),
    email
      ? count(
          admin
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("seller_account_id", order.seller_account_id)
            .eq("buyer_snapshot->>email", email)
            .gte("created_at", hourAgo),
        )
      : Promise.resolve(0),
    count(
      admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", order.seller_account_id)
        .gte("created_at", hourAgo),
    ),
  ]);
  if (age === null) return [];

  return run("checkout_init", order.seller_account_id, order.id, {
    accountAgeDays: age,
    currency: order.currency,
    orderTotalMinor: Number(order.total_minor),
    buyerOrdersLastHour: buyerOrders,
    sellerOrdersLastHour: sellerOrders,
  });
}

/** After a payout request was accepted by request_seller_payout. */
export async function assessPayoutRisk(
  input: { sellerAccountId: string; amountMinor: number; currency: "GHS" | "NGN" | "XOF"; requestKey: string },
  now = new Date(),
): Promise<RiskFinding[]> {
  const admin = createAdminClient();
  const since90d = ago(90 * DAY_MS, now);
  const [age, payouts, placed, refunded, cases, failures] = await Promise.all([
    accountAgeDays(admin, input.sellerAccountId, now),
    count(
      admin
        .from("payout_requests")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", input.sellerAccountId)
        .gte("created_at", ago(DAY_MS, now)),
    ),
    count(
      admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", input.sellerAccountId)
        .not("status", "in", "(draft,pending,cancelled)")
        .gte("created_at", since90d),
    ),
    count(
      admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", input.sellerAccountId)
        .in("refund_status", ["partial", "completed"])
        .gte("created_at", since90d),
    ),
    count(
      admin
        .from("support_cases")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", input.sellerAccountId)
        .gte("created_at", since90d),
    ),
    count(
      admin
        .from("payment_attempts")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", input.sellerAccountId)
        .eq("status", "failed")
        .gte("created_at", ago(7 * DAY_MS, now)),
    ),
  ]);
  if (age === null) return [];

  return run("payout_request", input.sellerAccountId, input.requestKey, {
    accountAgeDays: age,
    currency: input.currency,
    payoutAmountMinor: input.amountMinor,
    payoutsLast24h: payouts,
    disputeRate: placed > 0 ? cases / placed : 0,
    refundRate: placed > 0 ? refunded / placed : 0,
    paymentFailures: failures,
  });
}

/** After a KYC result was applied. */
export async function assessKycRisk(
  input: { sellerAccountId: string; checkId: string; status: string; matchScore: number | null },
  now = new Date(),
): Promise<RiskFinding[]> {
  const admin = createAdminClient();
  const [age, failures] = await Promise.all([
    accountAgeDays(admin, input.sellerAccountId, now),
    count(
      admin
        .from("kyc_checks")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", input.sellerAccountId)
        .eq("status", "failed")
        .gte("created_at", ago(30 * DAY_MS, now)),
    ),
  ]);
  if (age === null) return [];

  return run("kyc_result", input.sellerAccountId, input.checkId, {
    accountAgeDays: age,
    kycStatus: input.status,
    kycMatchScore: input.matchScore,
    kycFailuresLast30d: failures,
  });
}
