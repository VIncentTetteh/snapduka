import Link from "next/link";
import { notFound } from "next/navigation";

import { resolveCaseAction } from "@/app/admin/actions";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const { data: item } = await createAdminClient().from("support_cases")
    .select("*,orders(public_reference,buyer_snapshot),seller_accounts(id,contact_name),case_messages(*)")
    .eq("id",caseId).maybeSingle();
  if (!item) notFound();
  const order = item.orders[0];
  const seller = item.seller_accounts[0];
  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-3 py-5">
      <header><p className="font-bold uppercase tracking-wide text-emerald-900">{order?.public_reference}</p><h1 className="m-0 text-4xl font-black">{item.reason}</h1><p>{item.status} · seller {seller?.contact_name}</p></header>
      <section className="rounded-2xl border border-stone-300 bg-white p-4"><p>{item.description}</p>{item.case_messages.map((message:{id:string;body:string;operator_only:boolean;created_at:string})=><p key={message.id}>{message.operator_only?"Operator note":"Message"} · {message.body}</p>)}</section>
      <form action={resolveCaseAction} className="grid gap-2 rounded-2xl border border-stone-300 bg-white p-4"><input name="caseId" type="hidden" value={item.id}/><select className="min-h-11 rounded-xl border px-3" name="status"><option value="under_review">Under review</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><textarea className="min-h-24 rounded-xl border p-3" name="resolution" placeholder="Buyer-visible outcome or reason"/><button className="min-h-11 rounded-xl bg-emerald-900 px-4 font-bold text-white">Update case</button></form>
      {seller ? <Link className="font-bold text-emerald-900" href={`/admin/sellers/${seller.id}`}>Review seller and risk actions</Link> : null}
    </main>
  );
}
