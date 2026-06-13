import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminCasesPage() {
  const { data: cases } = await createAdminClient().from("support_cases").select("id,reason,status,created_at,orders(public_reference),seller_accounts(contact_name)").order("created_at",{ascending:false});
  return <main className="mx-auto grid max-w-5xl gap-4 px-3 py-5"><header><p className="font-bold uppercase tracking-wide text-emerald-900">Operator console</p><h1 className="m-0 text-4xl font-black">Support cases</h1></header>{cases?.map((item)=><Link className="rounded-2xl border border-stone-300 bg-white p-4 text-stone-950 no-underline" href={`/admin/cases/${item.id}`} key={item.id}><strong>{item.orders?.[0]?.public_reference} · {item.reason}</strong><p>{item.seller_accounts?.[0]?.contact_name} · {item.status}</p></Link>)}</main>;
}
