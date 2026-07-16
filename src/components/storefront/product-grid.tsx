import Link from "next/link";

import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { deriveAvailability } from "@/lib/catalog/inventory";
import { mainImageUrl } from "@/lib/storefront/media";

type Product = {
  id: string;
  name: string;
  description: string;
  currency: "GHS" | "NGN" | "XOF";
  price_minor: number;
  inventory_policy: "track" | "continue_selling" | "deny_when_out_of_stock";
  stock_quantity: number | null;
  reserved_quantity: number;
  product_media?: { object_path: string; alt_text: string | null; position: number }[] | null;
};

const currencySymbol: Record<string, string> = { GHS: "GH₵", NGN: "₦", XOF: "CFA" };

function priceDisplay(minor: number, currency: string): string {
  if (currency === "XOF") return `${minor.toLocaleString("en-US")}`;
  return (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function ProductGrid({
  slug,
  products,
  campaign,
}: {
  slug: string;
  products: Product[];
  campaign?: string;
}) {
  if (!products.length) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-[#C9BBA6] bg-raised px-6 py-14 text-center">
        <p className="font-serif text-[19px] font-medium text-ink">No products yet</p>
        <p className="mt-1.5 text-[13.5px] text-ink-soft">
          Check back soon — the seller is adding items.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(46%,220px),1fr))] gap-3.5">
      {products.map((product) => {
        const availability = deriveAvailability({
          policy: product.inventory_policy,
          stock: product.stock_quantity,
          reserved: product.reserved_quantity,
        });
        const soldOut = availability === "sold_out";
        const lowStock =
          product.inventory_policy === "track" &&
          product.stock_quantity != null &&
          product.stock_quantity - product.reserved_quantity <= 4 &&
          !soldOut;
        const sym = currencySymbol[product.currency] ?? product.currency;
        const price = priceDisplay(product.price_minor, product.currency);
        const imageUrl = mainImageUrl(product.product_media);
        const href = `/${slug}/products/${product.id}${campaign ? `?campaign=${encodeURIComponent(campaign)}` : ""}`;

        return (
          <Link
            key={product.id}
            href={href}
            className="block overflow-hidden rounded-[14px] border border-line bg-white no-underline transition-colors hover:border-[#B9AC98]"
          >
            <span className="relative block">
              {imageUrl ? (
                // Product media may be a seller-configured Supabase object URL.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={product.name}
                  src={imageUrl}
                  className="block aspect-[1/0.85] w-full object-cover"
                  style={{ opacity: soldOut ? 0.55 : 1 }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="block aspect-[1/0.85]"
                  style={{
                    background: gradientForSeed(product.id),
                    opacity: soldOut ? 0.55 : 1,
                  }}
                />
              )}
              {soldOut ? (
                <span className="absolute left-2.5 top-2.5 rounded-full bg-ink px-2.5 py-1 text-[10.5px] font-bold leading-none text-paper">
                  Sold out
                </span>
              ) : lowStock ? (
                <span className="absolute left-2.5 top-2.5 rounded-full bg-warn-tint px-2.5 py-1 text-[10.5px] font-bold leading-none text-warn">
                  Low stock
                </span>
              ) : null}
            </span>
            <span className="block px-3.5 pb-3.5 pt-3">
              <span className="mb-1 block truncate text-[13.5px] font-semibold text-ink">
                {product.name}
              </span>
              <span className="block text-[13.5px] font-bold text-price">
                {sym} {price}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
