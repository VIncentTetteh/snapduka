import { redirect } from "next/navigation";

import { bulkProductStatusAction, setProductStatusAction } from "@/app/(seller)/dashboard/products/actions";
import { ProductForm } from "@/components/seller/product-form";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") {
    redirect("/login?next=/dashboard/products");
  }

  const supabase = await createClient();
  const [{ data: shop }, { data: products, error }] = await Promise.all([
    supabase
      .from("shops")
      .select("currency")
      .eq("seller_account_id", actor.sellerAccountId)
      .single(),
    supabase
      .from("products")
      .select("id, name, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity")
      .eq("seller_account_id", actor.sellerAccountId)
      .order("created_at", { ascending: false }),
  ]);

  if (!shop) redirect("/onboarding");

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="m-0 text-xs font-extrabold uppercase tracking-widest text-emerald-900">Seller dashboard</p>
        <h1 className="m-0 text-4xl font-black tracking-tight sm:text-6xl">Products</h1>
      </header>
      <ProductForm currency={shop.currency as "GHS" | "NGN" | "XOF"} />
      <form action={bulkProductStatusAction} className="flex gap-2" id="bulk-products"><select className="min-h-11 rounded-xl border px-3" name="status"><option value="active">Publish selected</option><option value="draft">Hide selected</option><option value="archived">Archive selected</option></select><button className="secondaryAction">Apply</button></form>
      <section className="grid gap-3" aria-labelledby="products-heading">
        <h2 id="products-heading" className="m-0 text-2xl font-extrabold">Your catalog</h2>
        {error ? <p role="alert">Products could not be loaded.</p> : null}
        {!products?.length ? <p>No products yet.</p> : null}
        {products?.map((product) => (
          <article className="grid gap-2 rounded-2xl border border-stone-300 bg-white p-4" key={product.id}>
            <label className="font-bold"><input form="bulk-products" name="productIds" type="checkbox" value={product.id}/> Select</label>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="m-0 text-xl font-extrabold">{product.name}</h3>
                <p className="m-0 text-stone-600">{product.currency} {product.price_minor} · {product.status}</p>
              </div>
              <strong>{product.inventory_policy === "track" ? `${Math.max(0, (product.stock_quantity ?? 0) - product.reserved_quantity)} available` : product.inventory_policy === "continue_selling" ? "Preorder" : "Available"}</strong>
            </div>
            <div className="flex flex-wrap gap-2">
              {product.status !== "active" ? (
                <form action={setProductStatusAction}><input name="productId" type="hidden" value={product.id} /><input name="status" type="hidden" value="active" /><button className="min-h-11 rounded-xl bg-emerald-900 px-4 font-bold text-white">Publish</button></form>
              ) : (
                <form action={setProductStatusAction}><input name="productId" type="hidden" value={product.id} /><input name="status" type="hidden" value="draft" /><button className="min-h-11 rounded-xl border border-stone-400 px-4 font-bold">Hide</button></form>
              )}
              <form action={setProductStatusAction}><input name="productId" type="hidden" value={product.id} /><input name="status" type="hidden" value="archived" /><button className="min-h-11 rounded-xl border border-stone-400 px-4 font-bold">Archive</button></form>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
