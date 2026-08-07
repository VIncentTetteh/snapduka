import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Compares what the ledger says SnapDuka holds against what Paystack actually
 * holds, and freezes withdrawals if they disagree.
 *
 * Runs the internal invariants even when Paystack is unreachable, because the
 * checks that matter most — the books balancing, the cached balances agreeing
 * with their entries — need no provider at all.
 */
export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();

  let balances: Array<{ currency: string; balanceMinor: number }> = [];
  let providerReachable = true;
  try {
    balances = await paystackProvider().balances();
  } catch (error) {
    providerReachable = false;
    console.error(
      "[reconcile] Paystack balance unavailable:",
      error instanceof Error ? error.message : "unknown",
    );
  }

  const { data: countries } = await admin
    .from("country_configs")
    .select("currency")
    .eq("settlement_mode", "ledger");

  const currencies = [...new Set((countries ?? []).map((row) => row.currency))];
  const results: Record<string, string> = {};

  for (const currency of currencies) {
    const match = balances.find((row) => row.currency === currency);
    const { data, error } = await admin.rpc("record_ledger_reconciliation", {
      p_currency: currency,
      // Required in SQL but nullable: null records "we could not reach the
      // provider", which is different from a balance of zero.
      p_provider_balance_minor: (providerReachable ? (match?.balanceMinor ?? 0) : null) as number,
    });
    if (error) {
      console.error(`[reconcile] ${currency} failed: ${error.message}`);
      results[currency] = "error";
      continue;
    }
    results[currency] = String(data);
    if (data === "drift") {
      // Withdrawals are already frozen by the RPC. This is the line an operator
      // needs to see, so it is logged loudly rather than only recorded.
      console.error(`[reconcile] DRIFT in ${currency} — withdrawals frozen for this market.`);
    }
  }

  return NextResponse.json({ providerReachable, results });
}

export const GET = POST;
