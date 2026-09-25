import { NextResponse } from "next/server";

import { getKycProviderById } from "@/lib/kyc/registry";
import { applyKycResult } from "@/lib/kyc/service";

/**
 * KYC vendor webhooks. One route per vendor id so a result for a check started
 * under a previous vendor still lands after we switch.
 *
 * The signature is checked over the raw body before anything is parsed: a
 * forged "passed" here would verify a seller, and verification gates payouts.
 * Results are applied through apply_kyc_result, which is idempotent, so a
 * vendor's retries are harmless. A failure to apply returns 5xx so the vendor
 * retries rather than the result being lost.
 */

function lowerCaseHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const provider = getKycProviderById(providerId);
  if (!provider) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  const webhook = { rawBody: await request.text(), headers: lowerCaseHeaders(request) };
  if (!(await provider.verifyWebhook(webhook))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = provider.parseWebhook(webhook);
  let applied = 0;
  try {
    for (const result of results) {
      const outcome = await applyKycResult(provider.id, result);
      if (outcome.applied) applied += 1;
    }
  } catch (error) {
    console.error(`[kyc/webhook] ${provider.id} result could not be applied`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not apply the result." }, { status: 500 });
  }

  return NextResponse.json({ received: results.length, applied });
}
