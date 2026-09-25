import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { withCronMonitor } from "@/lib/observability/cron";

/**
 * Compares what the ledger says SnapDuka holds against what Paystack actually
 * holds, and freezes withdrawals if they disagree.
 *
 * Runs the internal invariants even when Paystack is unreachable, because the
 * checks that matter most — the books balancing, the cached balances agreeing
 * with their entries — need no provider at all.
 */
async function runJob(request: Request) {
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

  // Every currency with any money on the ledger: markets fully cut over, plus
  // markets where a pilot cohort is (per-seller settlement_mode_override).
  // record_ledger_reconciliation decides whether drift may freeze payouts.
  const [{ data: countries }, { data: pilotSellers }] = await Promise.all([
    admin.from("country_configs").select("country,currency,settlement_mode"),
    admin
      .from("seller_accounts")
      .select("country")
      .eq("settlement_mode_override", "ledger")
      .limit(1000),
  ]);
  const pilotCountries = new Set((pilotSellers ?? []).map((row) => row.country));
  const currencies = [
    ...new Set(
      (countries ?? [])
        .filter((row) => row.settlement_mode === "ledger" || pilotCountries.has(row.country))
        .map((row) => row.currency),
    ),
  ];
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

export const POST = withCronMonitor("snapduka-reconcile-ledger", runJob, { schedule: "10 4 * * *" });
export const GET = POST;
