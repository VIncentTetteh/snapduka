import { notFound } from "next/navigation";

import { applyRiskAction } from "@/app/admin/actions";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminSellerPage({ params }: { params: Promise<{ sellerId: string }> }) {
  const { sellerId } = await params;
  const admin = createAdminClient();
  const [{data:seller},{data:actions}] = await Promise.all([
    admin.from("seller_accounts").select("id,contact_name,contact_email,status,country,shops(display_name,status),seller_verifications(state),payment_subaccounts(status)").eq("id",sellerId).maybeSingle(),
    admin.from("risk_actions").select("*").eq("seller_account_id",sellerId).order("created_at",{ascending:false}),
  ]);
  if (!seller) notFound();
  return <main className="mx-auto grid max-w-3xl gap-4 px-3 py-5"><header><p className="font-bold uppercase tracking-wide text-emerald-900">Seller risk review</p><h1 className="m-0 text-4xl font-black">{seller.contact_name}</h1><p>{seller.contact_email} · {seller.country} · {seller.status}</p></header><form action={applyRiskAction} className="grid gap-2 rounded-2xl border border-red-300 bg-white p-4"><input name="sellerId" type="hidden" value={seller.id}/><select className="min-h-11 rounded-xl border px-3" name="riskAction"><option value="warning">Warning</option><option value="require_verification">Require verification</option><option value="restrict_payments">Restrict payments</option><option value="suspend">Temporarily suspend</option><option value="remove">Permanently remove</option></select><textarea className="min-h-24 rounded-xl border p-3" name="reason" placeholder="Required operational reason"/><label><input name="confirm" required type="checkbox" value="yes"/> I confirm this high-impact action</label><button className="min-h-11 rounded-xl bg-red-800 px-4 font-bold text-white">Apply risk action</button></form><section><h2>Audit history</h2>{actions?.map((action)=><p key={action.id}>{new Date(action.created_at).toLocaleString()} · {action.action} · {action.reason}</p>)}</section></main>;
}
