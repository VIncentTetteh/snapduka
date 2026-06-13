"use client";

import { useActionState } from "react";

import {
  createProductAction,
  type ProductActionState,
} from "@/app/(seller)/dashboard/products/actions";
import { ImageUploader } from "@/components/seller/image-uploader";

const initialState: ProductActionState = { status: "idle", values: {} };

export function ProductForm({ currency }: { currency: "GHS" | "NGN" }) {
  const [state, action, pending] = useActionState(
    createProductAction,
    initialState,
  );
  const input =
    "min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base";

  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-stone-300 bg-white p-4">
      <h2 className="m-0 text-xl font-extrabold">Add a product</h2>
      {state.message ? (
        <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>
      ) : null}
      <label className="font-bold" htmlFor="name">Name</label>
      <input className={input} defaultValue={state.values.name} id="name" name="name" required />
      <label className="font-bold" htmlFor="description">Description</label>
      <textarea className={input} defaultValue={state.values.description} id="description" name="description" rows={3} />
      <label className="font-bold" htmlFor="price">Price in minor units</label>
      <input className={input} defaultValue={state.values.price} id="price" inputMode="numeric" name="price" required />
      <input name="currency" type="hidden" value={currency} />
      <label className="font-bold" htmlFor="sku">SKU</label>
      <input className={input} defaultValue={state.values.sku} id="sku" name="sku" />
      <label className="font-bold" htmlFor="inventoryPolicy">Availability</label>
      <select className={input} defaultValue={state.values.inventoryPolicy || "track"} id="inventoryPolicy" name="inventoryPolicy">
        <option value="track">Track finite stock</option>
        <option value="continue_selling">Preorder</option>
        <option value="deny_when_out_of_stock">Always available</option>
      </select>
      <label className="font-bold" htmlFor="stockQuantity">Stock quantity</label>
      <input className={input} defaultValue={state.values.stockQuantity} id="stockQuantity" inputMode="numeric" name="stockQuantity" />
      <fieldset className="grid gap-2 rounded-xl border border-stone-200 p-3">
        <legend className="font-bold">Optional first variant</legend>
        <input className={input} defaultValue={state.values.variantName} name="variantName" placeholder="Variant name, e.g. Large" />
        <input className={input} defaultValue={state.values.variantPrice} inputMode="numeric" name="variantPrice" placeholder="Variant price in minor units" />
        <input className={input} defaultValue={state.values.variantSku} name="variantSku" placeholder="Variant SKU" />
        <input className={input} defaultValue={state.values.variantStock} inputMode="numeric" name="variantStock" placeholder="Variant stock" />
      </fieldset>
      <ImageUploader />
      <label className="font-bold" htmlFor="status">Save as</label>
      <select className={input} defaultValue={state.values.status || "draft"} id="status" name="status">
        <option value="draft">Draft</option>
        <option value="active">Published</option>
      </select>
      <button className="min-h-11 rounded-xl bg-emerald-900 px-4 font-bold text-white disabled:opacity-60" disabled={pending}>
        {pending ? "Saving..." : "Save product"}
      </button>
    </form>
  );
}
