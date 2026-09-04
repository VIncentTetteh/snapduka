"use client";

import { useActionState, useState } from "react";

import { submitProductReview, type ReviewFormState } from "@/app/orders/[token]/actions";

/**
 * The buyer's review form, on their own order page.
 *
 * Deliberately one product at a time and opened on demand: a form per line
 * expanded by default turns a receipt into a chore, and most buyers review one
 * thing.
 */
export function ReviewForm({
  token,
  productId,
  productName,
}: {
  token: string;
  productId: string;
  productName: string;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(
    submitProductReview,
    {},
  );

  if (state.ok) {
    return (
      <p className="mt-2 rounded-[10px] bg-success-tint px-3 py-2 text-[12.5px] font-medium text-success">
        {state.message}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        className="mt-2 rounded-[9px] border border-line-strong bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98]"
        onClick={() => setOpen(true)}
        type="button"
      >
        Write a review
      </button>
    );
  }

  return (
    <form action={action} className="mt-2.5 rounded-[10px] border border-line bg-raised p-3">
      <input name="token" type="hidden" value={token} />
      <input name="productId" type="hidden" value={productId} />
      <input name="rating" type="hidden" value={rating} />

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1.5 p-0 text-[12.5px] font-semibold text-ink-2">
          How was {productName}?
        </legend>
        <span className="flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              aria-pressed={rating === value}
              className="cursor-pointer border-0 bg-transparent p-0.5 leading-none"
              key={value}
              onClick={() => setRating(value)}
              type="button"
            >
              <svg
                fill={value <= rating ? "#A8431A" : "#EAE2D6"}
                height="22"
                viewBox="0 0 16 16"
                width="22"
              >
                <path d="M8 1.6l1.94 3.93 4.34.63-3.14 3.06.74 4.32L8 11.5l-3.88 2.04.74-4.32L1.72 6.16l4.34-.63L8 1.6z" />
              </svg>
            </button>
          ))}
        </span>
      </fieldset>

      <textarea
        className="mt-2.5 min-h-20 w-full rounded-[10px] border border-line-input bg-white px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        maxLength={2000}
        name="body"
        placeholder="What did you think? (optional)"
      />

      <input
        className="mt-2 w-full rounded-[10px] border border-line-input bg-white px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        maxLength={80}
        name="authorName"
        placeholder="Your name (optional)"
      />

      {state.error ? (
        <p className="mt-2 text-[12.5px] font-medium text-danger">{state.error}</p>
      ) : null}

      <span className="mt-2.5 flex gap-2">
        <button
          className="rounded-[9px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-btn transition-colors hover:bg-accent-deep disabled:opacity-45"
          disabled={pending || rating === 0}
          type="submit"
        >
          {pending ? "Sending…" : "Post review"}
        </button>
        <button
          className="rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-line-soft"
          onClick={() => setOpen(false)}
          type="button"
        >
          Cancel
        </button>
      </span>
    </form>
  );
}
