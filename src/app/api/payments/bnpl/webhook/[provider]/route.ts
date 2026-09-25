import { NextResponse } from "next/server";

import { applyBnplOutcome } from "@/lib/bnpl/capture";
import { getBnplProviderById } from "@/lib/bnpl/registry";

/**
 * BNPL partner webhooks: the partner's final answer on a checkout. One route
 * per partner id, so outcomes for checkouts started under a previous partner
 * still land after a switch.
 *
 * The signature is checked over the raw body before anything is parsed: an
 * approval here marks an order paid. Applying is idempotent (the capture
 * dedupes on the partner's event id), and a failure returns 5xx so the partner
 * retries rather than the payment being lost.
 */

function lowerCaseHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getBnplProviderById(providerId);
  if (!provider) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  const webhook = { rawBody: await request.text(), headers: lowerCaseHeaders(request) };
  if (!(await provider.verifyWebhook(webhook))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outcomes = provider.parseWebhook(webhook);
  const results: string[] = [];
  try {
    for (const outcome of outcomes) {
      results.push(await applyBnplOutcome(provider.id, outcome));
    }
  } catch (error) {
    console.error(`[bnpl/webhook] ${provider.id} outcome could not be applied`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not apply the outcome." }, { status: 500 });
  }
  return NextResponse.json({ received: outcomes.length, results });
}
