import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  sellerAccountId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  trackingToken: z.uuid().optional(),
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(5) }),
}).refine((value) => Boolean(value.sellerAccountId) !== Boolean(value.customerId));

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });

  const admin = createAdminClient();
  if (parsed.data.sellerAccountId) {
    const actor = await resolveServerActor();
    if (actor.kind !== "seller" || actor.sellerAccountId !== parsed.data.sellerAccountId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else {
    if (!parsed.data.trackingToken) return NextResponse.json({ error: "Order proof is required." }, { status: 401 });
    const { data: order } = await admin.from("orders").select("customer_id").eq("tracking_token", parsed.data.trackingToken).maybeSingle();
    if (!order || order.customer_id !== parsed.data.customerId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const { error } = await admin.from("push_subscriptions").upsert({
    seller_account_id: parsed.data.sellerAccountId ?? null,
    customer_id: parsed.data.customerId ?? null,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    active: true,
  }, { onConflict: "endpoint" });
  return error
    ? NextResponse.json({ error: "Unable to subscribe." }, { status: 500 })
    : NextResponse.json({ subscribed: true }, { status: 201 });
}
