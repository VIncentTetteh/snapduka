import { notFound } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export default async function SellerSupportPage({params}:{params:Promise<{orderId:string}>}) {
  const actor=await resolveServerActor(); if(actor.kind!=="seller") return null;
  const {orderId}=await params; const {data:item}=await (await createClient()).from("support_cases").select("*,case_messages(*)").eq("order_id",orderId).eq("seller_account_id",actor.sellerAccountId).maybeSingle();
  if(!item) notFound();
  return <main className="mx-auto grid max-w-3xl gap-4 px-3 py-5 pb-24"><h1 className="text-4xl font-black">Support case</h1><p>{item.reason} · {item.status}</p><p>{item.description}</p>{item.case_messages.filter((message:{operator_only:boolean})=>!message.operator_only).map((message:{id:string;body:string;created_at:string})=><p key={message.id}>{new Date(message.created_at).toLocaleString()} · {message.body}</p>)}</main>;
}
