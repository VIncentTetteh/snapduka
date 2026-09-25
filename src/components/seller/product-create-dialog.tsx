"use client";

import { useEffect, useRef, useState } from "react";

import { DraftFromPhoto } from "@/components/seller/draft-from-photo";
import { type CategoryOption, ProductForm } from "@/components/seller/product-form";
import { Button } from "@/components/ui/button";
import type { ListingDraft } from "@/lib/ai/listing-draft";
import type { PreparedImage } from "@/lib/catalog/images";

type Prefill = { key: number; values: Record<string, string>; image: PreparedImage; note: string };

/**
 * Map a Snap-to-list draft onto the form's field names. Always a draft.
 *
 * The suggested category prefills the Category field when that field is shown
 * and the category is still in the taxonomy; otherwise it is only mentioned in
 * the note, as before, so the suggestion is never silently lost.
 */
function prefillFromDraft(
  draft: ListingDraft,
  image: PreparedImage,
  key: number,
  categories: CategoryOption[],
): Prefill {
  const local = draft.descriptionLocal ? `\n\n${draft.descriptionLocal.text}` : "";
  const suggested = draft.category;
  const prefillCategory = suggested && categories.some((category) => category.id === suggested.id) ? suggested.id : "";
  return {
    key,
    values: {
      name: draft.title,
      description: `${draft.description}${local}`,
      status: "draft",
      ...(prefillCategory ? { categoryId: prefillCategory } : {}),
    },
    image,
    note: `${suggested && !prefillCategory ? `Suggested category: ${suggested.name}. ` : ""}${draft.price.explanation}`,
  };
}

export function ProductCreateDialog({
  currency,
  snapToList = false,
  categories = [],
}: {
  currency: "GHS" | "NGN" | "XOF";
  /** Show "Draft from photo" (the snap_to_list flag, resolved on the server). */
  snapToList?: boolean;
  /** The taxonomy, when `product_categories` is on; empty hides the field. */
  categories?: CategoryOption[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const keepInside = (event: MouseEvent) => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener("click", keepInside);
    return () => dialog.removeEventListener("click", keepInside);
  }, []);

  return (
    <>
      <Button onClick={() => dialogRef.current?.showModal()}>
        <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 20 20" width="16">
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
        Add product
      </Button>
      <dialog
        aria-labelledby="create-product-title"
        className="m-auto max-h-[calc(100svh-32px)] w-[min(760px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line bg-white p-0 text-ink shadow-[0_24px_80px_rgba(39,33,27,0.24)] backdrop:bg-ink/45 backdrop:backdrop-blur-[2px]"
        ref={dialogRef}
      >
        <div className="flex max-h-[calc(100svh-32px)] flex-col">
          <div className="flex flex-none items-start justify-between gap-4 border-b border-line-soft px-5 py-4 sm:px-6">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-accent">Catalogue</p>
              <h2 id="create-product-title" className="mt-1 font-serif text-[23px] font-medium text-ink">Create a product</h2>
              <p className="mt-1 text-[12.5px] text-ink-muted">Add the essentials now; refine the listing whenever you like.</p>
            </div>
            <button
              aria-label="Close product form"
              className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full border border-line bg-white text-xl text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
            {snapToList ? (
              <DraftFromPhoto
                onDraft={(draft, image) => setPrefill(prefillFromDraft(draft, image, (prefill?.key ?? 0) + 1, categories))}
              />
            ) : null}
            {/* Remounted per draft: the form's fields are uncontrolled, so a new
                key is how a fresh draft replaces what the last one filled in. */}
            <ProductForm
              categories={categories}
              currency={currency}
              draftNote={prefill?.note}
              initialImage={prefill?.image}
              initialValues={prefill?.values}
              key={prefill?.key ?? 0}
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
