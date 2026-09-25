import { after } from "next/server";

import type { RiskContext } from "@/lib/risk/signals";

/**
 * Run a risk assessment after the response has been sent.
 *
 * The risk engine is observe-only today, so it must cost the buyer or seller
 * nothing: no added latency (it runs in `after`), and no way to fail the
 * request (every error is caught and logged). Payment, payout and KYC
 * behaviour is identical whether the assessment succeeds, fails, or never runs.
 *
 * The engine is imported lazily inside the callback. This module is imported
 * by hot money routes; keeping the engine (and its server-only admin client)
 * out of their import graph means adding this call cannot change how those
 * routes load, or how their existing tests mock them.
 */
export function scheduleRiskAssessment(
  context: RiskContext,
  task: (engine: typeof import("@/lib/risk/engine")) => Promise<unknown>,
): void {
  const job = async () => {
    try {
      await task(await import("@/lib/risk/engine"));
    } catch (error) {
      console.error(`[risk] ${context} assessment failed`, error instanceof Error ? error.message : error);
    }
  };
  try {
    after(job);
  } catch {
    // Outside a request scope (a script, a unit test of the caller) there is
    // no `after`. Assessment is best-effort; the caller's work is unaffected.
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[risk] ${context} assessment skipped: no request scope`);
    }
  }
}
