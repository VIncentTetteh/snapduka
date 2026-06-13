import Link from "next/link";

import { MetricCard } from "@/components/seller/metric-card";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ count: newOrders }, { data: completed }, { data: shop }] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("seller_account_id", actor.sellerAccountId).eq("status", "pending"),
    supabase.from("orders").select("total_minor,currency").eq("seller_account_id", actor.sellerAccountId).eq("status", "completed").gte("updated_at", new Date(new Date().setHours(0,0,0,0)).toISOString()),
    supabase.from("shops").select("slug").eq("seller_account_id", actor.sellerAccountId).maybeSingle(),
  ]);
  const total = completed?.reduce((sum, order) => sum + order.total_minor, 0) ?? 0;
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-5 px-3 py-5 pb-24">
      <header><p className="font-bold uppercase tracking-wide text-emerald-900">Commerce cockpit</p><h1 className="m-0 text-4xl font-black">Today at a glance</h1></header>
      <section className="grid grid-cols-2 gap-3"><MetricCard label="New orders" value={String(newOrders ?? 0)} /><MetricCard label="Completed value" value={`${completed?.[0]?.currency ?? "GHS"} ${(total / 100).toFixed(2)}`} /><MetricCard label="Completed orders" value={String(completed?.length ?? 0)} /><MetricCard label="Next action" value={(newOrders ?? 0) > 0 ? "Review orders" : "Share your shop"} /></section>
      <div className="flex flex-wrap gap-2"><Link className="min-h-11 rounded-xl bg-emerald-900 px-4 py-3 font-bold text-white" href="/dashboard/products">Add product</Link><Link className="min-h-11 rounded-xl border border-stone-400 px-4 py-3 font-bold" href="/dashboard/orders">Manage orders</Link>{shop ? <Link className="min-h-11 rounded-xl border border-stone-400 px-4 py-3 font-bold" href={`/${shop.slug}`}>View shop</Link> : null}</div>
    </main>
  );
}
