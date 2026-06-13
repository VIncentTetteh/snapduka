import Link from "next/link";

import { deriveAvailability } from "@/lib/catalog/inventory";

type Product = {
  id: string;
  name: string;
  description: string;
  currency: "GHS" | "NGN" | "XOF";
  price_minor: number;
  inventory_policy: "track" | "continue_selling" | "deny_when_out_of_stock";
  stock_quantity: number | null;
  reserved_quantity: number;
};

export function ProductGrid({ slug, products, campaign }: { slug: string; products: Product[]; campaign?: string }) {
  if (!products.length) {
    return <p className="rounded-2xl bg-white p-5 text-stone-600">No matching products are available right now.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((product) => {
        const availability = deriveAvailability({
          policy: product.inventory_policy,
          stock: product.stock_quantity,
          reserved: product.reserved_quantity,
        });
        return (
          <Link className="grid min-w-0 gap-2 rounded-2xl border border-stone-200 bg-white p-3 text-stone-950 no-underline shadow-sm" href={`/${slug}/products/${product.id}${campaign ? `?campaign=${encodeURIComponent(campaign)}` : ""}`} key={product.id}>
            <div className="aspect-square rounded-xl bg-gradient-to-br from-amber-100 to-emerald-100" aria-hidden="true" />
            <h2 className="m-0 truncate text-base font-extrabold">{product.name}</h2>
            <strong>{product.currency} {product.currency === "XOF" ? product.price_minor : (product.price_minor / 100).toFixed(2)}</strong>
            <span className={availability === "sold_out" ? "text-red-800" : "text-emerald-800"}>
              {availability === "preorder" ? "Preorder" : availability === "sold_out" ? "Sold out" : "Available"}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
