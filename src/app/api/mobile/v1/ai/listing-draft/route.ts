import { z } from "zod";

import { createListingDraft } from "@/lib/ai/listing-draft";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Snap-to-list for the seller app: a product photo in, a draft listing out.
 *
 * The photo arrives either as a path the app already uploaded to the
 * `product-images` bucket (preferred: the same upload becomes the product's
 * image) or inline as base64 for a photo that has not been uploaded yet. The
 * response is a draft only — nothing is written to `products`; the app shows
 * it on the product form for the seller to edit and save.
 *
 * Contract:
 *   POST { image: { path } | { base64, mediaType } }
 *   200  { draft: ListingDraft }            (see src/lib/ai/listing-draft.ts)
 *   403  forbidden  — role lacks products.manage, or snap_to_list is off
 *   403  plan_limit — this month's AI budget is spent
 *   422  validation_failed — bad body or unusable image
 *   409  conflict   — AI is not configured on the server
 */

const schema = z.object({
  image: z.union([
    z.object({ path: z.string().min(3).max(300) }),
    z.object({
      // ~5 MB of base64 — the per-image cap is enforced precisely downstream.
      base64: z.string().min(16).max(5_100_000),
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    }),
  ]),
});

export async function POST(request: Request) {
  const actor = await requireSeller("products.manage");
  if (isResponse(actor)) return actor;

  // Each call is a paid vision request; the budget caps the month, this caps a
  // runaway retry loop in the app.
  const limited = await enforceRateLimit("ai.listing-draft", actor.sellerAccountId, {
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await createListingDraft({
      sellerAccountId: actor.sellerAccountId,
      image:
        "path" in body.image
          ? { kind: "storage", path: body.image.path }
          : { kind: "base64", data: body.image.base64, mediaType: body.image.mediaType },
    });
    if (result.ok) return ok({ draft: result.draft });

    switch (result.reason) {
      case "not_enabled":
        return fail("forbidden", result.message);
      case "budget_exceeded":
        return fail("plan_limit", result.message);
      case "invalid_image":
        return fail("validation_failed", result.message, { fields: { image: result.message } });
      case "no_shop":
      case "not_configured":
        return fail("conflict", result.message);
      case "failed":
        return fail("internal", result.message);
    }
  } catch (error) {
    return failUnexpected("ai.listing-draft", error);
  }
}
