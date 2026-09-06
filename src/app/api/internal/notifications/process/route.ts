import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/notifications/email";
import { nextAttemptAt } from "@/lib/notifications/outbox";
import { sendPush } from "@/lib/notifications/push";
import { sendSms } from "@/lib/notifications/sms";
import {
  creatorUpdateTemplate,
  orderUpdateTemplate,
  type CreatorNotificationEvent,
} from "@/lib/notifications/templates";

const CREATOR_EVENTS: readonly CreatorNotificationEvent[] = [
  "creator_partnership_accepted",
  "creator_commission_earned",
  "creator_payment_recorded",
];

function isCreatorEvent(template: string): template is CreatorNotificationEvent {
  return (CREATOR_EVENTS as readonly string[]).includes(template);
}
import { sendWhatsApp } from "@/lib/notifications/whatsapp";
import { appOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("notifications").select("*")
    .in("status", ["pending","failed"]).lte("available_at", new Date().toISOString()).order("created_at").limit(20);
  let processed = 0;
  for (const job of jobs ?? []) {
    const { data: claimed } = await admin.from("notifications").update({ status: "queued", claimed_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq("id", job.id).eq("attempts", job.attempts).select("*").maybeSingle();
    if (!claimed) continue;
    try {
      const origin = await appOrigin();
      // notifications.payload is jsonb, so it arrives as `Json` — an array or a
      // scalar are both valid there. Narrowing once means the rest of this loop
      // cannot read a property off something that has none.
      const payload: Record<string, unknown> =
        claimed.payload && typeof claimed.payload === "object" && !Array.isArray(claimed.payload)
          ? (claimed.payload as Record<string, unknown>)
          : {};
      const trackingUrl = payload.trackingToken
        ? `${origin}/orders/${String(payload.trackingToken)}`
        : origin;

      // Every row used to be rendered as an order update regardless of its
      // `template` column, so anything else came out as "Order undefined is now
      // undefined". Creator messages are about a partnership, a commission or a
      // payment and have no order behind them at all.
      const template = isCreatorEvent(claimed.template)
        ? creatorUpdateTemplate({
            event: claimed.template,
            shopName: String(payload.shopName ?? "A SnapDuka shop"),
            amount: payload.amount ? String(payload.amount) : undefined,
            portalUrl: `${origin}/creator`,
          })
        : orderUpdateTemplate({
            reference: String(payload.reference),
            status: String(payload.status),
            trackingUrl: String(trackingUrl),
          });
      if (claimed.channel === "email") {
        const result = await sendEmail(claimed.recipient, template.subject, template.text);
        if (!result.delivered) throw new Error(result.reason);
      } else if (claimed.channel === "whatsapp") {
        const result = await sendWhatsApp(claimed.recipient, template.text);
        if (!result.delivered) throw new Error(result.reason);
      } else if (claimed.channel === "push") {
        // orderId rides along so tapping the notification on a phone opens that
        // order rather than the app's home tab.
        const result = await sendPush(
          claimed.recipient,
          template.subject,
          template.text,
          String(trackingUrl),
          payload.orderId ? { orderId: String(payload.orderId) } : undefined,
        );
        if (!result.delivered) throw new Error(result.reason);
      } else if (claimed.channel === "sms") {
        const result = await sendSms(claimed.recipient, template.text);
        if (!result.delivered) throw new Error(result.reason);
      } else if (claimed.channel !== "in_app") {
        throw new Error(`Unsupported notification channel: ${claimed.channel}`);
      }
      await admin.from("notifications").update({ status: "sent", last_error: null }).eq("id", claimed.id);
      await admin.from("notification_attempts").insert({ notification_id: claimed.id, attempt: claimed.attempts, outcome: "sent" });
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // A missing provider is not a transient failure. Retrying it five times
      // with exponential backoff burns a day of worker runs to reach the same
      // answer, and buries the real cause under generic retry noise. Fail it
      // straight to dead_letter with the reason intact.
      const retryAt = message === "not_configured"
        ? null
        : nextAttemptAt(new Date(), claimed.attempts);
      await admin.from("notifications").update({
        status: retryAt ? "failed" : "dead_letter", available_at: retryAt?.toISOString() ?? claimed.available_at,
        last_error: error instanceof Error ? error.message.slice(0,500) : "Unknown provider failure",
      }).eq("id", claimed.id);
      await admin.from("notification_attempts").insert({ notification_id: claimed.id, attempt: claimed.attempts, outcome: retryAt ? "retry" : "dead_letter", error: error instanceof Error ? error.message.slice(0,500) : "Unknown" });
    }
  }
  return NextResponse.json({ processed });
}

export const GET = POST;
