import { getCapitalOverview } from "@/lib/financing/service";
import { isResponse, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * The seller's Capital screen (flag `stock_financing`): eligibility, the open
 * offer if any, and advances with repayment progress. Same shape for web and
 * app.
 *
 * Owner only. An advance is a debt the account owner takes on with a lending
 * partner; a manager must not be able to see, let alone accept, one.
 */
export async function GET() {
  const actor = await requireSeller("billing.manage");
  if (isResponse(actor)) return actor;
  if (actor.role) return fail("forbidden", "Only the account owner can see Capital.");

  try {
    return ok(await getCapitalOverview({ sellerAccountId: actor.sellerAccountId, country: actor.country }));
  } catch (error) {
    return failUnexpected("financing.overview", error);
  }
}
