import { redirect } from "next/navigation";

import { saveFulfillmentMethod } from "./actions";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function FulfillmentSettingsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") redirect("/login?next=/dashboard/settings/fulfillment");
  const supabase = await createClient();
  const { data: methods } = await supabase.from("fulfillment_methods").select("id, type, name, fee_minor, instructions, active").eq("seller_account_id", actor.sellerAccountId).order("position");
  const input = "min-h-11 rounded-xl border border-stone-300 bg-white px-3 py-2";
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5">
      <header><p className="font-bold uppercase tracking-wide text-emerald-900">Seller settings</p><h1 className="m-0 text-4xl font-black">Delivery and pickup</h1></header>
      <form action={saveFulfillmentMethod} className="grid gap-3 rounded-2xl border border-stone-300 bg-white p-4">
        <select className={input} name="type"><option value="delivery">Seller delivery</option><option value="pickup">Buyer pickup</option></select>
        <input className={input} name="name" placeholder="Accra delivery" required />
        <input className={input} inputMode="numeric" name="feeMinor" placeholder="Fee in minor units" required />
        <textarea className={input} name="instructions" placeholder="Areas, timing, or pickup directions" />
        <button className="min-h-11 rounded-xl bg-emerald-900 px-4 font-bold text-white">Add method</button>
      </form>
      <section className="grid gap-2"><h2 className="text-2xl font-extrabold">Available methods</h2>{methods?.map((method) => <article className="rounded-xl border border-stone-300 bg-white p-4" key={method.id}><strong>{method.name}</strong><p>{method.type} · fee {method.fee_minor}</p><p>{method.instructions}</p></article>)}</section>
    </main>
  );
}
