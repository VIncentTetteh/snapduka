import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { ProductGrid } from "@/components/storefront/product-grid";
import { ShopHeader } from "@/components/storefront/shop-header";
import { getPublicProducts, getPublicShop } from "@/lib/storefront/queries";
import { canonicalStorefrontUrl } from "@/lib/storefront/sharing";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; collection?: string; page?: string }>;
};

function origin() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) return {};
  const url = canonicalStorefrontUrl(origin(), slug);
  return {
    title: `${shop.display_name} | SnapDuka`,
    description: `Shop ${shop.display_name} securely on SnapDuka.`,
    alternates: { canonical: url },
    openGraph: { title: shop.display_name, url, images: [`/${slug}/opengraph-image`] },
  };
}

export default async function StorefrontPage({ params, searchParams }: Props) {
  const [{ slug }, filters] = await Promise.all([params, searchParams]);
  const shop = await getPublicShop(slug);
  if (!shop) notFound();
  const canonicalUrl = canonicalStorefrontUrl(origin(), slug);
  const [products, qrDataUrl] = await Promise.all([
    getPublicProducts(shop.id, {
      search: filters.q,
      collection: filters.collection,
      page: Number(filters.page || 1),
    }),
    QRCode.toDataURL(canonicalUrl, { width: 640, margin: 2 }),
  ]);

  return (
    <main className="mx-auto min-h-svh w-full max-w-5xl pb-16" style={{ backgroundColor: shop.shop_branding?.[0]?.surface_color ?? "#fafaf9", ["--accent" as string]: shop.shop_branding?.[0]?.accent_color ?? "#146b45" }}>
      <ShopHeader canonicalUrl={canonicalUrl} country={shop.country} name={shop.display_name} qrDataUrl={qrDataUrl} />
      <section className="grid gap-4 px-3 py-5">
        <form className="flex gap-2" role="search">
          <label className="sr-only" htmlFor="shop-search">Search products</label>
          <input className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3" defaultValue={filters.q} id="shop-search" name="q" placeholder="Search this shop" />
          <button className="min-h-11 rounded-xl bg-stone-900 px-4 font-bold text-white">Search</button>
        </form>
        <ProductGrid products={products} slug={slug} />
      </section>
    </main>
  );
}
