import { z } from "zod";

import { createAdCampaign, getAdsOverview } from "@/lib/ads/service";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Promoted listings (flag `promoted_listings`): the seller's ad budget and
 * campaigns (GET) and creating a campaign (POST). campaigns.manage, like the
 * rest of the marketing surface; moving money into the budget is owner-only
 * and lives at /api/ads/budget.
 */
export async function GET() {
  const actor = await requireSeller("campaigns.manage");
  if (isResponse(actor)) return actor;
  try {
    return ok(await getAdsOverview({ sellerAccountId: actor.sellerAccountId, country: actor.country }));
  } catch (error) {
    return failUnexpected("ads.overview", error);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the campaign.").max(80),
  productIds: z.array(z.uuid()).min(1, "Choose at least one product.").max(50),
  dailyBudgetMinor: z.number().int().positive(),
  bidMinor: z.number().int().positive(),
});

export async function POST(request: Request) {
  const actor = await requireSeller("campaigns.manage");
  if (isResponse(actor)) return actor;
  const limited = await enforceRateLimit("ads.create", actor.sellerAccountId, { limit: 20, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await parseBody(request, createSchema);
  if (isResponse(body)) return body;

  try {
    const result = await createAdCampaign({ sellerAccountId: actor.sellerAccountId, userId: actor.userId, ...body });
    if (!result.ok) return fail(result.reason === "disabled" ? "forbidden" : "validation_failed", result.message);
    return ok({ campaignId: result.value }, 201);
  } catch (error) {
    return failUnexpected("ads.create", error);
  }
}
