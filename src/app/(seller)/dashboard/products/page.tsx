import Link from "next/link";
import { redirect } from "next/navigation";

import { setProductStatusAction } from "@/app/(seller)/dashboard/products/actions";
import { ProductForm } from "@/components/seller/product-form";
import { ProductStatusBadge } from "@/components/seller/status-badges";
import { ProductStatusToggle } from "@/components/seller/product-status-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { mainImageUrl } from "@/lib/storefront/media";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") redirect("/login?next=/dashboard/products");

  const supabase = await createClient();
  const [{ data: shop }, { data: products, error }] = await Promise.all([
    supabase.from("shops").select("currency").eq("seller_account_id", actor.sellerAccountId).single(),
    supabase
      .from("products")
      .select("id,name,currency,price_minor,status,inventory_policy,stock_quantity,reserved_quantity,product_media(object_path,position)")
      .eq("seller_account_id", actor.sellerAccountId)
      .order("created_at", { ascending: false }),
  ]);

  if (!shop) redirect("/onboarding");

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader title="Products" sub="Your catalogue — prices, stock and visibility." />

      {/* Add product */}
      <Panel className="mb-5 p-4.5">
        <h2 className="mb-3 text-[14px] font-bold">Add a product</h2>
        <ProductForm currency={shop.currency as "GHS" | "NGN" | "XOF"} />
      </Panel>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] font-semibold text-danger"
        >
          Products could not be loaded.
        </div>
      ) : null}

      {!error && !products?.length ? (
        <EmptyState
          title="Your catalogue is empty"
          body="Add your first product above — a name, a price and stock is enough to start selling."
        />
      ) : null}

      {products && products.length > 0 ? (
        <Panel className="overflow-hidden">
          {products.map((product) => {
            const available =
              product.inventory_policy === "track"
                ? Math.max(0, (product.stock_quantity ?? 0) - product.reserved_quantity)
                : null;
            const outOfStock = product.inventory_policy === "track" && (available ?? 0) === 0;
            const lowStock = !outOfStock && available != null && available <= 4;
            const isActive = product.status === "active";

            const stockText = outOfStock
              ? "Out of stock"
              : lowStock
                ? `${available} left`
                : available != null
                  ? `${available} in stock`
                  : "Unlimited";
            const stockClass = outOfStock
              ? "text-ink-faint"
              : lowStock
                ? "text-warn"
                : "text-ink-muted";

            return (
              <div
                key={product.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
              >
                <Link
                  href={`/dashboard/products/${product.id}`}
                  aria-label={`Edit ${product.name}`}
                  className="no-underline"
                >
                  {mainImageUrl(product.product_media) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      src={mainImageUrl(product.product_media)!}
                      className="block h-12 w-12 rounded-xl object-cover"
                      style={{ opacity: isActive ? 1 : 0.55 }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="block h-12 w-12 rounded-xl"
                      style={{ background: gradientForSeed(product.id), opacity: isActive ? 1 : 0.55 }}
                    />
                  )}
                </Link>
                <Link
                  href={`/dashboard/products/${product.id}`}
                  className="min-w-0 no-underline"
                >
                  <span className="block truncate text-[14px] font-semibold text-ink">
                    {product.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-bold text-price">
                      {formatMoney(product.price_minor, product.currency as CurrencyCode)}
                    </span>
                    <span className={`text-[12px] font-semibold ${stockClass}`}>{stockText}</span>
                    <ProductStatusBadge status={product.status} soldOut={outOfStock} />
                  </span>
                </Link>

                {/* Share + publish toggle */}
                <span className="flex flex-none items-center gap-2">
                <Link
                  href={`/dashboard/share?product=${product.id}`}
                  aria-label={`Share ${product.name}`}
                  title="Share this product"
                  className="grid h-9 w-9 place-items-center rounded-[9px] border border-line-strong bg-white text-ink-soft no-underline transition-colors hover:border-[#B9AC98] hover:text-ink"
                >
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M13.5 6.5 6.8 9.6m0 .9 6.7 3M16 5a2.2 2.2 0 1 1-4.4 0A2.2 2.2 0 0 1 16 5ZM8.4 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Zm7.6 5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                <form action={setProductStatusAction} className="flex-none">
                  <input name="productId" type="hidden" value={product.id} />
                  <input name="status" type="hidden" value={isActive ? "draft" : "active"} />
                  <ProductStatusToggle
                    ariaLabel={isActive ? `Hide ${product.name}` : `Publish ${product.name}`}
                    checked={isActive}
                    title={isActive ? "Hide product" : "Publish product"}
                  />
                </form>
                </span>
              </div>
            );
          })}
        </Panel>
      ) : null}
    </main>
  );
}
