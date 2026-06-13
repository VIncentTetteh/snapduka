"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

export default function BuyerSupportPage() {
  const { token } = useParams<{ token: string }>();
  const [message,setMessage] = useState("");
  return <main className="mx-auto grid min-h-svh max-w-2xl content-center gap-4 px-3"><p className="font-bold uppercase tracking-wide text-emerald-900">Structured mediation</p><h1 className="m-0 text-4xl font-black">Get help with your order</h1><p>SnapDuka helps the buyer and seller exchange evidence and reach an outcome. This is not escrow or guaranteed buyer protection.</p><form className="grid gap-3" onSubmit={async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const response=await fetch(`/api/orders/${token}/support`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:form.get("reason"),description:form.get("description")})});const result=await response.json();setMessage(response.ok?`Case opened: ${result.caseId}`:result.error);}}><select className="min-h-11 rounded-xl border border-stone-300 px-3" name="reason"><option value="item_not_received">Item not received</option><option value="item_not_as_described">Item not as described</option><option value="payment_issue">Payment issue</option><option value="refund_request">Refund request</option><option value="other">Other</option></select><textarea className="min-h-32 rounded-xl border border-stone-300 p-3" name="description" placeholder="Explain what happened and the outcome you want" required /><button className="min-h-11 rounded-xl bg-emerald-900 px-4 font-bold text-white">Open case</button></form><p role="status">{message}</p></main>;
}
