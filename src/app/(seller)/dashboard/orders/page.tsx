import Link from "next/link";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { bulkOrderStatusAction } from "./actions";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const filters = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("orders").select("id,public_reference,status,payment_status,fulfillment_status,total_minor,currency,buyer_snapshot,created_at").eq("seller_account_id", actor.sellerAccountId).order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q) query = query.ilike("public_reference", `%${filters.q}%`);
  const { data: orders } = await query;
  return <main className="mx-auto grid w-full max-w-5xl gap-4 px-3 py-5 pb-24"><header><p className="font-bold uppercase tracking-wide text-emerald-900">Seller dashboard</p><h1 className="m-0 text-4xl font-black">Orders</h1></header><form className="flex gap-2"><input className="min-h-11 flex-1 rounded-xl border border-stone-300 px-3" defaultValue={filters.q} name="q" placeholder="Search reference" /><select className="min-h-11 rounded-xl border border-stone-300 px-3" defaultValue={filters.status} name="status"><option value="">All states</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="processing">Processing</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button className="rounded-xl bg-stone-900 px-4 font-bold text-white">Filter</button></form><form action={bulkOrderStatusAction} className="flex gap-2" id="bulk-orders"><select className="min-h-11 rounded-xl border px-3" name="status"><option value="confirmed">Confirm selected</option><option value="processing">Process selected</option><option value="completed">Complete selected</option><option value="cancelled">Cancel selected</option></select><button className="secondaryAction">Apply</button></form><section className="grid gap-2">{orders?.map((order) => <article className="rounded-2xl border border-stone-300 bg-white p-4" key={order.id}><label className="font-bold"><input form="bulk-orders" name="orderIds" type="checkbox" value={order.id}/> Select</label><Link className="block text-stone-950 no-underline" href={`/dashboard/orders/${order.id}`}><strong>{order.public_reference}</strong><p className="m-0">{String(order.buyer_snapshot.name)} · {order.currency} {order.currency==="XOF"?order.total_minor:(order.total_minor/100).toFixed(2)}</p><p className="m-0">{order.status} · {order.payment_status} · {order.fulfillment_status}</p></Link></article>)}{!orders?.length ? <p>No matching orders.</p> : null}</section></main>;
}
