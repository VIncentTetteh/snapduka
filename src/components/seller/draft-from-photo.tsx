"use client";

import { useState } from "react";

import { draftListingFromPhotoAction } from "@/app/(seller)/dashboard/products/draft-actions";
import type { ListingDraft } from "@/lib/ai/listing-draft";
import { type PreparedImage, prepareImage, validateProductImage } from "@/lib/catalog/images";

/**
 * "Draft from photo" — the Snap-to-list entry point in the create-product
 * dialog. Picks a photo, resizes it in the browser (the same 1000px JPEG the
 * form would upload anyway), and hands the draft plus the prepared photo back
 * so the form can prefill itself. Nothing is saved from here.
 */
export function DraftFromPhoto({
  onDraft,
}: {
  onDraft: (draft: ListingDraft, image: PreparedImage) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validation = validateProductImage(file);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const image = await prepareImage(file);
      const result = await draftListingFromPhotoAction({ dataUrl: image.dataUrl });
      if (result.ok) onDraft(result.draft, image);
      else setError(result.message);
    } catch {
      setError("We could not draft this listing. Try another photo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-dashed border-line-strong bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold text-ink">Draft from photo</p>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            Snap your product and we will fill in a title and description for you to check. You set the price.
          </p>
        </div>
        <label
          className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line-strong bg-white px-3.5 text-[12.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98] ${pending ? "pointer-events-none opacity-60" : ""}`}
        >
          {pending ? "Drafting…" : "Choose photo"}
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="Choose a product photo to draft from"
            className="sr-only"
            disabled={pending}
            onChange={handlePick}
            type="file"
          />
        </label>
      </div>
      {error ? (
        <p className="mt-2 text-[13px] font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
