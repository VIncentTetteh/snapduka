import { z } from "zod";

import { updateAdCampaign } from "@/lib/ads/service";
import { isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/** Pause, resume, end, or change the bid and daily budget of one campaign. */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pause", "resume", "end"]) }),
  z.object({
    action: z.literal("update_terms"),
    dailyBudgetMinor: z.number().int().positive(),
    bidMinor: z.number().int().positive(),
  }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSeller("campaigns.manage");
  if (isResponse(actor)) return actor;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", "Campaign not found.");
  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await updateAdCampaign({ sellerAccountId: actor.sellerAccountId, campaignId: id, change: body });
    if (!result.ok) return fail(result.reason === "disabled" ? "forbidden" : "conflict", result.message);
    return ok({ state: result.value });
  } catch (error) {
    return failUnexpected("ads.update", error);
  }
}
