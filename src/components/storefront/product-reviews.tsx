import { RatingStars } from "@/components/storefront/rating-stars";

type Review = {
  id: string;
  author_name: string;
  rating: number;
  body: string | null;
  seller_reply: string | null;
  seller_replied_at: string | null;
  created_at: string;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * What other buyers said.
 *
 * Every review here came from an order whose tracking token was checked
 * server-side, so "Verified purchase" is a fact rather than a badge — which is
 * the entire reason a buyer would trust one of these over a review on a social
 * post.
 */
export function ProductReviews({
  reviews,
  ratingAvg,
  reviewCount,
}: {
  reviews: Review[];
  ratingAvg: number;
  reviewCount: number;
}) {
  if (reviewCount === 0) {
    return (
      <section className="mt-10" aria-labelledby="reviews-heading">
        <h2 id="reviews-heading" className="mb-3 font-serif text-[22px] font-medium text-ink">
          Reviews
        </h2>
        <p className="rounded-2xl border border-dashed border-[#C9BBA6] bg-raised px-6 py-10 text-center text-[14px] text-ink-soft">
          No reviews yet — be the first once your order arrives.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10" aria-labelledby="reviews-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="reviews-heading" className="font-serif text-[22px] font-medium text-ink">
          Reviews
        </h2>
        <RatingStars rating={ratingAvg} count={reviewCount} />
      </div>

      <ul className="grid gap-3.5">
        {reviews.map((review) => (
          <li
            key={review.id}
            className="rounded-2xl border border-line bg-white p-4.5"
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <RatingStars rating={review.rating} showCount={false} />
              <span className="text-[13.5px] font-semibold text-ink">
                {review.author_name}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-semibold text-success">
                Verified purchase
              </span>
              <span className="ml-auto text-[12px] text-ink-muted">
                {formatDate(review.created_at)}
              </span>
            </div>

            {review.body ? (
              <p className="text-[14px] leading-[1.6] text-ink-soft">{review.body}</p>
            ) : null}

            {review.seller_reply ? (
              <div className="mt-3 rounded-[10px] border-l-2 border-accent bg-[#FFF8F1] px-3.5 py-2.5">
                <p className="mb-0.5 text-[12px] font-semibold text-accent">
                  Reply from the seller
                </p>
                <p className="text-[13.5px] leading-[1.55] text-ink-soft">
                  {review.seller_reply}
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
