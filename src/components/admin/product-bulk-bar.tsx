"use client";

import Link from "next/link";
import { useState } from "react";

import { bulkModerateProductsAction } from "@/app/admin/products/actions";
import { ModerationBadge } from "@/components/admin/moderation-badge";
import { ProductStatusBadge } from "@/components/seller/status-badges";
import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { Panel } from "@/components/ui/surface";

export type AdminProductRow = {
  id: string;
  name: string;
  sellerName: string;
  imageUrl: string | null;
  priceLabel: string;
  stockLabel: string;
  stockTone: "muted" | "warn" | "faint";
  status: string;
  moderationStatus: string;
};

const STOCK_TONE_CLASS: Record<AdminProductRow["stockTone"], string> = {
  muted: "text-ink-muted",
  warn: "text-warn",
  faint: "text-ink-faint",
};

/** Product list with checkbox multi-select and a sticky bulk-moderation bar. */
export function ProductListWithBulkActions({ products }: { products: AdminProductRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedIds = Array.from(selected);

  return (
    <>
      <Panel className="overflow-hidden pb-16">
        {products.map((product) => (
          <div
            key={product.id}
            className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
          >
            <input
              type="checkbox"
              aria-label={`Select ${product.name}`}
              checked={selected.has(product.id)}
              onChange={() => toggle(product.id)}
              className="h-[17px] w-[17px] accent-accent"
            />
            <Link href={`/admin/products/${product.id}`} aria-label={product.name} className="no-underline">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={product.imageUrl}
                  className="block h-11 w-11 rounded-xl object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="block h-11 w-11 rounded-xl"
                  style={{ background: gradientForSeed(product.id) }}
                />
              )}
            </Link>
            <Link href={`/admin/products/${product.id}`} className="min-w-0 no-underline">
              <span className="block truncate text-[14px] font-semibold text-ink">{product.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-ink-soft">{product.sellerName}</span>
                <span className="text-[13px] font-bold text-price">{product.priceLabel}</span>
                <span className={`text-[12px] font-semibold ${STOCK_TONE_CLASS[product.stockTone]}`}>
                  {product.stockLabel}
                </span>
              </span>
            </Link>
            <span className="flex flex-none flex-col items-end gap-1">
              <ProductStatusBadge status={product.status} />
              <ModerationBadge status={product.moderationStatus} />
            </span>
          </div>
        ))}
      </Panel>

      {selectedIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(33,27,20,0.08)] sm:px-6">
          <form
            action={bulkModerateProductsAction}
            onSubmit={() => setSelected(new Set())}
            className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-3"
          >
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="productIds" value={id} />
            ))}
            <span className="text-[13px] font-semibold text-ink">
              {selectedIds.length} selected
            </span>
            <input
              name="reason"
              required
              placeholder="Reason (required)"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-line-input bg-white px-3.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <button
              type="submit"
              name="decision"
              value="hidden"
              className="min-h-10 cursor-pointer rounded-[10px] border-none bg-danger px-4 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Hide
            </button>
            <button
              type="submit"
              name="decision"
              value="flagged"
              className="min-h-10 cursor-pointer rounded-[10px] border-none bg-warn px-4 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Flag
            </button>
            <button
              type="submit"
              name="decision"
              value="clear"
              className="min-h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-bold text-ink transition-colors hover:border-[#B9AC98]"
            >
              Clear
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
