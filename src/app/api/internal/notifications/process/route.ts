import { NextResponse } from "next/server";

import type { CurrencyCode } from "@snapduka/core";
import { formatMoney } from "@snapduka/core";
import { sendEmail } from "@/lib/notifications/email";
import { nextAttemptAt } from "@/lib/notifications/outbox";
import { sendPush } from "@/lib/notifications/push";
import { sendSms } from "@/lib/notifications/sms";
import {
  creatorUpdateTemplate,
  orderUpdateTemplate,
  sellerFinanceTemplate,
  type SellerFinanceEvent,
  type CreatorNotificationEvent,
} from "@/lib/notifications/templates";

const CREATOR_EVENTS: readonly CreatorNotificationEvent[] = [
  "creator_partnership_accepted",
  "creator_commission_earned",
  "creator_commission_payable",
  "creator_payment_recorded",
  "creator_wallet_available",
];

const FINANCE_EVENTS: readonly SellerFinanceEvent[] = ["financing_disbursed", "financing_repaid"];

function isFinanceEvent(template: string): template is SellerFinanceEvent {
  return (FINANCE_EVENTS as readonly string[]).includes(template);
}

function isCreatorEvent(template: string): template is CreatorNotificationEvent {
  return (CREATOR_EVENTS as readonly string[]).includes(template);
}
import {
  PERMANENT_WHATSAPP_FAILURES,
  sendWhatsApp,
  whatsAppTemplateForNotification,
} from "@/lib/notifications/whatsapp";
import { appOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { withCronMonitor } from "@/lib/observability/cron";

/** The amount on a creator message, in their currency. */
function creatorAmount(payload: Record<string, unknown>): string | undefined {
  if (payload.amount) return String(payload.amount);
  const minor = Number(payload.amountMinor);
  const currency = payload.currency ? String(payload.currency) : null;
  if (!currency || !Number.isFinite(minor)) return undefined;
  return formatMoney(minor, currency as CurrencyCode);
}

async function runJob(request: Request) {
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
            // Formatted here rather than by whoever enqueued it: the two
            // events that fire from SQL cannot reach Intl.NumberFormat, so the
            // amount travels as minor units and a currency and is rendered
            // once, in one place, for every path.
            amount: creatorAmount(payload),
            portalUrl: `${origin}/creator`,
          })
        : isFinanceEvent(claimed.template)
          ? sellerFinanceTemplate({
              event: claimed.template,
              amount: payload.amountMinor != null ? creatorAmount(payload) : undefined,
              dashboardUrl: `${origin}/dashboard`,
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
        // Free-form inside the buyer's 24h window; outside it, the approved
        // template for this event (if there is one).
        const result = await sendWhatsApp(claimed.recipient, template.text, {
          sellerAccountId: claimed.seller_account_id,
          template: whatsAppTemplateForNotification(claimed.template, payload, String(trackingUrl)),
        });
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
      const retryAt = message === "not_configured" || PERMANENT_WHATSAPP_FAILURES.has(message)
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

export const POST = withCronMonitor("snapduka-notifications", runJob, { schedule: "*/2 * * * *" });
export const GET = POST;
