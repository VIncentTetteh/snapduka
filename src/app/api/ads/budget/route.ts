import { z } from "zod";

import { moveAdBudget } from "@/lib/ads/service";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Move money between the seller's available balance and their prepaid ad
 * budget. Owner only: this spends wallet money, which in this codebase only
 * the owner may direct (see dashboard/payouts/actions.ts). The client sends an
 * idempotency key per intent so a retried request moves money once.
 */
const schema = z.object({
  direction: z.enum(["top_up", "withdraw"]),
  amountMinor: z.number().int().positive(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,120}$/, "Invalid idempotency key."),
});

export async function POST(request: Request) {
  const actor = await requireSeller("billing.manage");
  if (isResponse(actor)) return actor;
  if (actor.role) return fail("forbidden", "Only the account owner can move money into ads.");
  const limited = await enforceRateLimit("ads.budget", actor.sellerAccountId, { limit: 20, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await moveAdBudget({ sellerAccountId: actor.sellerAccountId, ...body });
    if (!result.ok) return fail(result.reason === "disabled" ? "forbidden" : "conflict", result.message);
    return ok({ moved: true });
  } catch (error) {
    return failUnexpected("ads.budget", error);
  }
}
