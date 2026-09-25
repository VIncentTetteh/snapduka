import { z } from "zod";

import { acceptFinancingOffer } from "@/lib/financing/service";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Accept a stock-financing offer. The body repeats the total and terms
 * version the seller was shown, plus an explicit confirmation; the SQL refuses
 * anything that no longer matches the offer, so a stale screen cannot accept
 * terms the seller never saw.
 *
 * Owner only, like every action that commits the account to a debt.
 */
const schema = z.object({
  expectedTotalMinor: z.number().int().positive(),
  termsVersion: z.string().min(1).max(20),
  confirm: z.literal(true, { error: "Confirm that you accept the terms." }),
});

const FAILURE_CODE = {
  disabled: "forbidden",
  not_found: "not_found",
  not_configured: "forbidden",
  refused: "conflict",
  declined: "conflict",
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSeller("billing.manage");
  if (isResponse(actor)) return actor;
  if (actor.role) return fail("forbidden", "Only the account owner can accept financing.");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", "That offer was not found.");

  const limited = await enforceRateLimit("financing.accept", actor.sellerAccountId, { limit: 5, windowMs: 60 * 60_000 });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await acceptFinancingOffer({
      sellerAccountId: actor.sellerAccountId,
      userId: actor.userId,
      offerId: id,
      expectedTotalMinor: body.expectedTotalMinor,
      termsVersion: body.termsVersion,
    });
    if (!result.ok) return fail(FAILURE_CODE[result.reason], result.message);
    return ok({ advanceId: result.advanceId, state: result.state }, 201);
  } catch (error) {
    return failUnexpected("financing.accept", error);
  }
}
