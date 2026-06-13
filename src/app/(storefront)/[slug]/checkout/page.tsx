import Link from "next/link";
import { notFound } from "next/navigation";

import { CheckoutForm } from "@/components/storefront/checkout-form";
import { getPublicProduct, getPublicShop } from "@/lib/storefront/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ product?: string; campaign?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const shop = await getPublicShop(slug);
  if (!shop || !query.product) notFound();
  const product = await getPublicProduct(shop.id, query.product);
  if (!product) notFound();
  const { data: methods } = await createAdminClient().from("fulfillment_methods")
    .select("id,name,type,fee_minor,instructions").eq("shop_id", shop.id).eq("active", true).order("position");
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-2xl gap-4 bg-stone-50 px-3 py-5 pb-16">
      <Link className="font-bold text-emerald-900" href={`/${slug}/products/${product.id}`}>← Back to product</Link>
      <header><p className="font-bold uppercase tracking-wide text-emerald-900">Secure guest checkout</p><h1 className="m-0 text-4xl font-black">Complete your order</h1><p>No account required. Review delivery and payment before confirming.</p></header>
      {!methods?.length ? <p role="alert">This seller has not enabled delivery or pickup yet.</p> : null}
      <CheckoutForm campaignToken={query.campaign} country={shop.country} methods={methods ?? []} product={product} shopId={shop.id} />
    </main>
  );
}
