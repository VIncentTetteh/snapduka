import { NextResponse } from "next/server";

import { getFinancingPartner } from "@/lib/financing/partner";
import { applyFinancingPartnerEvent } from "@/lib/financing/service";

/**
 * Lending-partner webhooks: an advance funded or declined, an advance the
 * partner has declared defaulted or written off, and the partner's funding
 * landing in SnapDuka's bank.
 *
 * The signature is checked over the raw body before anything is parsed: a
 * forged "funded" would credit a seller with money nobody sent. Each event is
 * applied idempotently and only to advances this partner owns; a failure
 * returns 5xx so the partner retries rather than the event being lost.
 */

function lowerCaseHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

export async function POST(request: Request, { params }: { params: Promise<{ partner: string }> }) {
  const { partner: partnerId } = await params;
  const partner = getFinancingPartner(partnerId);
  // An unknown or not-ready id resolves to not_configured, which never verifies.
  if (partner.id !== partnerId || partner.id === "not_configured") {
    return NextResponse.json({ error: "Unknown partner." }, { status: 404 });
  }

  const webhook = { rawBody: await request.text(), headers: lowerCaseHeaders(request) };
  if (!(await partner.verifyWebhook(webhook))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = partner.parseWebhook(webhook);
  let applied = 0;
  try {
    for (const event of events) {
      if ((await applyFinancingPartnerEvent(partner.id, event)).applied) applied += 1;
    }
  } catch (error) {
    console.error(`[financing/webhook] ${partner.id} event could not be applied`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not apply the event." }, { status: 500 });
  }
  return NextResponse.json({ received: events.length, applied });
}
