import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  reason: z.enum(["item_not_received","item_not_as_described","payment_issue","refund_request","other"]),
  description: z.string().trim().min(10).max(3000),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const [{ token }, parsed] = await Promise.all([params, request.json().then((body) => schema.safeParse(body)).catch(() => ({ success: false as const }))]);
  if (!parsed.success) return NextResponse.json({ error: "Describe the issue in at least 10 characters." }, { status: 400 });
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id,seller_account_id").eq("tracking_token",token).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const { data: supportCase, error } = await admin.from("support_cases").insert({
    order_id: order.id, seller_account_id: order.seller_account_id,
    reason: parsed.data.reason, description: parsed.data.description,
    status: "seller_response_due", response_due_at: new Date(Date.now()+48*3600_000).toISOString(),
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A case already exists for this order." : "Case could not be opened." }, { status: 409 });
  await admin.from("case_messages").insert({ case_id: supportCase.id, actor_type: "user", body: parsed.data.description });
  await admin.from("orders").update({ dispute_status: "seller_response_due" }).eq("id",order.id);
  return NextResponse.json({ caseId: supportCase.id }, { status: 201 });
}
