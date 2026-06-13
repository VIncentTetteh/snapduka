import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { ShareActions } from "@/components/storefront/share-actions";
import { deriveAvailability } from "@/lib/catalog/inventory";
import { getPublicProduct, getPublicShop } from "@/lib/storefront/queries";
import { canonicalStorefrontUrl } from "@/lib/storefront/sharing";

type Props = { params: Promise<{ slug: string; productId: string }> };
const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, productId } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) return {};
  const product = await getPublicProduct(shop.id, productId);
  if (!product) return {};
  const url = canonicalStorefrontUrl(origin(), slug, productId);
  return { title: `${product.name} | ${shop.display_name}`, description: product.description, alternates: { canonical: url }, openGraph: { title: product.name, url } };
}

export default async function ProductPage({ params }: Props) {
  const { slug, productId } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) notFound();
  const product = await getPublicProduct(shop.id, productId);
  if (!product) notFound();
  const url = canonicalStorefrontUrl(origin(), slug, productId);
  const qrDataUrl = await QRCode.toDataURL(url, { width: 640, margin: 2 });
  const availability = deriveAvailability({ policy: product.inventory_policy, stock: product.stock_quantity, reserved: product.reserved_quantity });

  return (
    <main className="mx-auto grid min-h-svh w-full max-w-3xl gap-5 bg-stone-50 px-3 py-5 pb-16">
      <Link className="font-bold text-emerald-900" href={`/${slug}`}>← {shop.display_name}</Link>
      <div className="aspect-square rounded-3xl bg-gradient-to-br from-amber-100 to-emerald-100" aria-label="Product image placeholder" />
      <section className="grid gap-3">
        <p className="m-0 font-bold uppercase tracking-wide text-emerald-900">{availability === "preorder" ? "Available for preorder" : availability.replace("_", " ")}</p>
        <h1 className="m-0 text-4xl font-black tracking-tight">{product.name}</h1>
        <strong className="text-2xl">{product.currency} {(product.price_minor / 100).toFixed(2)}</strong>
        <p className="m-0 whitespace-pre-wrap text-stone-700">{product.description || "Ask the seller for more product details."}</p>
        {product.product_variants?.length ? (
          <div>
            <h2 className="text-lg font-extrabold">Options</h2>
            <ul className="grid list-none gap-2 p-0">{product.product_variants.map((variant) => <li className="rounded-xl border border-stone-300 bg-white p-3" key={variant.id}>{variant.name}{variant.price_minor !== null ? ` · ${product.currency} ${(variant.price_minor / 100).toFixed(2)}` : ""}</li>)}</ul>
          </div>
        ) : null}
        <Link aria-disabled={availability === "sold_out"} className={`grid min-h-12 place-items-center rounded-xl px-4 text-lg font-extrabold text-white ${availability === "sold_out" ? "pointer-events-none bg-stone-400" : "bg-emerald-900"}`} href={`/${slug}/checkout?product=${product.id}`}>Buy now</Link>
        <p className="m-0 text-sm text-stone-600">You will see the full price, delivery or pickup options, and payment method before confirming.</p>
        <ShareActions name={product.name} qrDataUrl={qrDataUrl} url={url} />
      </section>
    </main>
  );
}
