"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useCart } from "@/components/storefront/cart-provider";

type Variant = {
  id: string;
  name: string;
  price_minor: number | null;
  inventory_policy: string;
  stock_quantity: number | null;
  reserved_quantity: number;
};

function variantSoldOut(variant: Variant) {
  return variant.inventory_policy === "track" && (variant.stock_quantity ?? 0) - variant.reserved_quantity <= 0;
}

function variantAvailable(variant: Variant): number | null {
  if (variant.inventory_policy !== "track") return null;
  return Math.max(0, (variant.stock_quantity ?? 0) - variant.reserved_quantity);
}

const SYMBOL: Record<string, string> = { GHS: "GH₵", NGN: "₦", XOF: "CFA" };

function money(minor: number, currency: string) {
  const sym = SYMBOL[currency] ?? currency;
  if (currency === "XOF") return `${sym} ${minor.toLocaleString("en-US")}`;
  return `${sym} ${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function PurchaseActions({
  campaign,
  currency,
  priceMinor,
  productId,
  shopSlug,
  soldOut,
  availableStock,
  variants,
}: {
  campaign?: string;
  currency: string;
  priceMinor: number;
  productId: string;
  shopSlug: string;
  soldOut: boolean;
  availableStock: number | null;
  variants: Variant[];
}) {
  const cart = useCart();
  const [variantId, setVariantId] = useState(
    variants.find((variant) => !variantSoldOut(variant))?.id ?? variants[0]?.id ?? "",
  );
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const selected = variants.find((variant) => variant.id === variantId);
  const unitPrice = selected?.price_minor ?? priceMinor;
  const unavailable = variants.length > 0 ? variants.every(variantSoldOut) : soldOut;
  const available = selected ? variantAvailable(selected) : availableStock;
  const maxQty = available == null ? 99 : Math.max(1, Math.min(99, available));

  const directHref = useMemo(() => {
    const params = new URLSearchParams({ product: productId });
    if (variantId) params.set("variant", variantId);
    if (qty > 1) params.set("qty", String(qty));
    if (campaign) params.set("campaign", campaign);
    return `/${shopSlug}/checkout?${params}`;
  }, [campaign, productId, qty, shopSlug, variantId]);

  function addToCart() {
    cart.add({ productId, variantId: variantId || null, quantity: qty });
    setAdded(true);
  }

  const stockNote =
    available != null && available > 0 && available <= 4 ? `Only ${available} left` : "";


  return (
    <>
      {variants.length > 0 && (
        <fieldset className="m-0 mb-4.5 border-0 p-0">
          <legend className="mb-2 p-0 text-[12.5px] font-bold text-ink">
            Choose an option
            {selected && available != null ? (
              <span className="ml-1.5 font-medium text-ink-muted">
                · {available > 0 ? `${available} in stock` : "Sold out"}
              </span>
            ) : null}
          </legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const isSoldOut = variantSoldOut(variant);
              const isSelected = variantId === variant.id;
              return (
                <label
                  key={variant.id}
                  className={`flex min-h-11 min-w-[52px] cursor-pointer items-center justify-center rounded-[10px] border px-3.5 text-[13.5px] font-bold transition-colors ${
                    isSelected
                      ? "border-[1.5px] border-accent bg-accent-tint text-accent"
                      : isSoldOut
                        ? "border-line-input bg-white text-ink-faint line-through"
                        : "border-line-input bg-white text-ink-soft hover:border-[#B9AC98]"
                  } ${isSoldOut ? "cursor-not-allowed" : ""}`}
                >
                  <input
                    type="radio"
                    name="variant"
                    className="sr-only"
                    value={variant.id}
                    checked={isSelected}
                    disabled={isSoldOut}
                    onChange={() => {
                      setVariantId(variant.id);
                      setQty(1);
                      setAdded(false);
                    }}
                  />
                  {variant.name}
                  {variant.price_minor != null ? ` · ${money(variant.price_minor, currency)}` : ""}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {unavailable ? null : (
        <>
          {/* Quantity stepper */}
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex items-center rounded-[10px] border border-line-input bg-white">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="h-11 w-11 cursor-pointer border-none bg-transparent text-[18px] text-ink-soft"
              >
                −
              </button>
              <span aria-live="polite" className="min-w-7 text-center text-[14px] font-bold">
                {qty}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                className="h-11 w-11 cursor-pointer border-none bg-transparent text-[18px] text-ink-soft"
              >
                +
              </button>
            </div>
            {stockNote ? (
              <p className="m-0 text-[12px] font-semibold text-warn">{stockNote}</p>
            ) : null}
          </div>

          {/* Purchase actions: sticky bottom bar on mobile, inline grid on sm+ */}
          <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-2.5 border-t border-line bg-raised/95 px-4 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:static sm:z-auto sm:mb-2 sm:grid sm:grid-cols-2 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <span className="text-[15px] font-bold text-ink sm:hidden">
              {money(unitPrice * qty, currency)}
            </span>
            <div className="flex-1 sm:hidden" />
            <button
              type="button"
              disabled={!cart.ready}
              onClick={addToCart}
              className="h-[46px] cursor-pointer rounded-[11px] border-[1.5px] border-ink bg-white px-4 text-[13.5px] font-bold text-ink transition-colors hover:bg-line-soft disabled:cursor-wait disabled:opacity-60 sm:h-[50px] sm:text-[14.5px]"
            >
              {!cart.ready ? "Loading…" : added ? "Added ✓" : "Add to cart"}
            </button>
            <Link
              href={directHref}
              className="grid h-[46px] place-items-center rounded-[11px] bg-accent px-4 text-center text-[13.5px] font-bold text-white no-underline transition-colors hover:bg-accent-deep sm:h-[50px] sm:text-[14.5px]"
            >
              Buy now
            </Link>
          </div>
          <p aria-live="polite" role="status" className="m-0 mb-1 min-h-[18px] text-[12.5px] font-semibold text-success">
            {added ? "Added to cart" : ""}
          </p>
        </>
      )}

      {cart.count > 0 && (
        <Link
          href={cart.checkoutHref}
          className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white no-underline shadow-float sm:bottom-6"
        >
          View cart · {cart.count} {cart.count === 1 ? "item" : "items"}
        </Link>
      )}
    </>
  );
}
