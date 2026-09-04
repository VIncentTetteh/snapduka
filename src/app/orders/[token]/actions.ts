"use server";

import { revalidatePath } from "next/cache";

import { checkRateLimit } from "@/lib/rate-limit";
import { submitReview } from "@/lib/reviews/submit";

export type ReviewFormState = { ok?: boolean; error?: string; message?: string };

/**
 * A buyer reviewing something they bought.
 *
 * Unauthenticated by design: buyers are guests everywhere in this product, and
 * the order's tracking token is the only credential they hold. Everything that
 * makes the review trustworthy — that the token matches an order, that the
 * order contained this product, that it was paid for — is checked inside
 * submitReview, not here.
 *
 * Rate limited on the token so a leaked link cannot be used to spray reviews.
 */
export async function submitProductReview(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const token = String(formData.get("token") ?? "");
  const productId = String(formData.get("productId") ?? "");
  if (!token || !productId) return { error: "That review could not be sent." };

  const limited = await checkRateLimit(`reviews.submit:${token}`, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!limited.ok) {
    return { error: "Too many reviews from this order just now. Try again shortly." };
  }

  const result = await submitReview({
    trackingToken: token,
    productId,
    rating: Number(formData.get("rating") ?? 0),
    body: String(formData.get("body") ?? ""),
    authorName: String(formData.get("authorName") ?? ""),
  });

  if (!result.ok) return { error: result.message };

  revalidatePath(`/orders/${token}`);
  return { ok: true, message: "Thank you — your review is live on the shop." };
}
