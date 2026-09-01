"use client";

import { useEffect, useRef } from "react";

import { ProductForm } from "@/components/seller/product-form";
import { Button } from "@/components/ui/button";

export function ProductCreateDialog({ currency }: { currency: "GHS" | "NGN" | "XOF" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
            <ProductForm currency={currency} />
          </div>
        </div>
      </dialog>
    </>
  );
}
