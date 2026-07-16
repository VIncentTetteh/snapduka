import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/notifications/email";
import { sendPush } from "@/lib/notifications/push";
import { sendWhatsApp } from "@/lib/notifications/whatsapp";
import { appOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";

type SegmentRules = { minimumOrders?: number; minimumSpendMinor?: number; orderedWithinDays?: number };
type CustomerOrder = { created_at: string; status: string; total_minor: number };

function matchesSegment(orders: CustomerOrder[], rules: SegmentRules) {
  const eligible = orders.filter((order) => order.status !== "cancelled");
  const recentCutoff = rules.orderedWithinDays ? Date.now() - rules.orderedWithinDays * 86_400_000 : null;
  return eligible.length >= (rules.minimumOrders ?? 0)
    && eligible.reduce((sum, order) => sum + Number(order.total_minor), 0) >= (rules.minimumSpendMinor ?? 0)
    && (!recentCutoff || eligible.some((order) => new Date(order.created_at).valueOf() >= recentCutoff));
}

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: broadcasts } = await admin
    .from("marketing_broadcasts")
    .select("id,seller_account_id,segment_id,channel,subject,body,customer_segments(rules)")
    .eq("state", "scheduled")
    .lte("scheduled_at", now)
    .order("scheduled_at")
    .limit(5);
  let delivered = 0;

  for (const broadcast of broadcasts ?? []) {
    const { data: claimed } = await admin.from("marketing_broadcasts").update({ state: "sending" }).eq("id", broadcast.id).eq("state", "scheduled").select("id").maybeSingle();
    if (!claimed) continue;
    const { data: preference } = await admin.from("notification_preferences").select("marketing_frequency_cap").eq("seller_account_id", broadcast.seller_account_id).maybeSingle();
    const cap = preference?.marketing_frequency_cap ?? 4;
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const { data: customers } = await admin
      .from("customers")
      .select("id,email,phone,orders(total_minor,status,created_at),customer_consents(purpose,status)")
      .eq("seller_account_id", broadcast.seller_account_id)
      .limit(1000);
    const rules = ((broadcast.customer_segments as unknown as { rules?: SegmentRules } | null)?.rules ?? {}) as SegmentRules;

    for (const customer of customers ?? []) {
      const consented = customer.customer_consents.some((consent) => consent.purpose === "marketing" && consent.status === "granted");
      let reason: string | null = consented ? null : "marketing_consent_not_granted";
      if (!reason && broadcast.segment_id && !matchesSegment(customer.orders as CustomerOrder[], rules)) reason = "outside_segment";
      if (!reason && cap === 0) reason = "frequency_cap_reached";
      if (!reason) {
        const { count } = await admin.from("marketing_deliveries").select("id", { count: "exact", head: true }).eq("seller_account_id", broadcast.seller_account_id).eq("customer_id", customer.id).eq("state", "sent").gte("sent_at", monthStart.toISOString());
        if ((count ?? 0) >= cap) reason = "frequency_cap_reached";
      }
      const { data: delivery } = await admin.from("marketing_deliveries").upsert({ broadcast_id: broadcast.id, customer_id: customer.id, seller_account_id: broadcast.seller_account_id, state: reason ? "skipped" : "queued", reason }, { onConflict: "broadcast_id,customer_id" }).select("id").maybeSingle();
      if (!delivery || reason) continue;

      try {
        if (broadcast.channel === "email") {
          const result = await sendEmail(customer.email, broadcast.subject ?? "An update from a shop you follow", broadcast.body);
          if (!result.delivered) throw new Error(result.reason);
        } else if (broadcast.channel === "whatsapp") {
          const result = await sendWhatsApp(customer.phone, broadcast.body);
          if (!result.delivered) throw new Error(result.reason);
        } else if (broadcast.channel === "push") {
          const { data: subscription } = await admin.from("push_subscriptions").select("endpoint").eq("customer_id", customer.id).eq("active", true).limit(1).maybeSingle();
          if (!subscription) throw new Error("no_active_push_subscription");
          const result = await sendPush(subscription.endpoint, broadcast.subject ?? "Shop update", broadcast.body, await appOrigin());
          if (!result.delivered) throw new Error(result.reason);
        } else {
          throw new Error("unsupported_channel");
        }
        await admin.from("marketing_deliveries").update({ state: "sent", sent_at: new Date().toISOString(), reason: null }).eq("id", delivery.id);
        delivered++;
      } catch (error) {
        await admin.from("marketing_deliveries").update({ state: "failed", reason: error instanceof Error ? error.message.slice(0, 300) : "delivery_failed" }).eq("id", delivery.id);
      }
    }
    await admin.from("marketing_broadcasts").update({ state: "sent" }).eq("id", broadcast.id);
  }
  return NextResponse.json({ broadcasts: broadcasts?.length ?? 0, delivered });
}

export const GET = POST;
