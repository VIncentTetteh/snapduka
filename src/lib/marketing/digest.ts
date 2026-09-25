import "server-only";

import { formatMoney, type CurrencyCode } from "@snapduka/core";

import { appOrigin } from "@/lib/app-url";
import { isFeatureEnabled } from "@/lib/flags";
import { sendSms } from "@/lib/notifications/sms";
import { sendWhatsAppTemplate } from "@/lib/notifications/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WaTemplateCall } from "@/lib/whatsapp/templates";

/**
 * The seller's morning digest (`notification_preferences.digest_frequency`).
 *
 * Daily sellers hear about yesterday; weekly sellers, on Mondays, about the
 * last seven days. WhatsApp first (the `seller_digest` template), SMS when
 * WhatsApp is unavailable — most sellers never message the SnapDuka number, so
 * a free-form WhatsApp message is almost never allowed and the template is the
 * only WhatsApp path.
 *
 * Nothing to say is not said: a period with no orders, nothing to fulfil and
 * no unread chats is recorded as `skipped`. A digest that is mostly zeros
 * teaches sellers to ignore the one that matters.
 *
 * Every outcome is written to `seller_digests` before moving on, which is what
 * makes a re-run (or pg_cron firing twice) harmless.
 */

const PAGE = 100;
/** Stop before the serverless limit; tomorrow's run picks up anyone left. */
const TIME_BUDGET_MS = 50_000;
const DAY_MS = 86_400_000;

export type DigestFrequency = "daily" | "weekly";

export type DigestSummary = {
  ordersCount: number;
  paidRevenueMinor: number;
  toFulfil: number;
  unreadConversations: number;
};

export type DigestRunResult = { considered: number; sent: number; skipped: number; failed: number };

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Which periods are due today: daily always, weekly on Mondays (UTC). */
export function duePeriods(now: Date): { frequency: DigestFrequency; from: Date; to: Date; label: string }[] {
  const to = startOfUtcDay(now);
  const periods: { frequency: DigestFrequency; from: Date; to: Date; label: string }[] = [
    { frequency: "daily", from: new Date(to.getTime() - DAY_MS), to, label: "yesterday" },
  ];
  if (to.getUTCDay() === 1) {
    periods.push({ frequency: "weekly", from: new Date(to.getTime() - 7 * DAY_MS), to, label: "last 7 days" });
  }
  return periods;
}

export function isWorthSending(summary: DigestSummary): boolean {
  return summary.ordersCount > 0 || summary.toFulfil > 0 || summary.unreadConversations > 0;
}

export function digestText(input: {
  shopName: string;
  label: string;
  summary: DigestSummary;
  currency: CurrencyCode;
  dashboardUrl: string;
}): string {
  const { summary } = input;
  return `SnapDuka summary for ${input.shopName} (${input.label}): ${summary.ordersCount} new orders, ${formatMoney(summary.paidRevenueMinor, input.currency)} in paid sales. ${summary.toFulfil} to fulfil and ${summary.unreadConversations} unread chats. Open your dashboard: ${input.dashboardUrl}`;
}

function digestTemplate(input: {
  shopName: string;
  label: string;
  summary: DigestSummary;
  currency: CurrencyCode;
  dashboardUrl: string;
}): WaTemplateCall {
  return {
    name: "seller_digest",
    params: {
      shop_name: input.shopName,
      period: input.label,
      orders: String(input.summary.ordersCount),
      revenue: formatMoney(input.summary.paidRevenueMinor, input.currency),
      to_fulfil: String(input.summary.toFulfil),
      unread: String(input.summary.unreadConversations),
      dashboard_url: input.dashboardUrl,
    },
  };
}

type DueSeller = {
  seller_account_id: string;
  contact_phone: string;
  shop_name: string;
  currency: CurrencyCode;
};

async function record(
  seller: DueSeller,
  periodStart: string,
  frequency: DigestFrequency,
  outcome: { status: "sent" | "skipped" | "failed"; channel?: "whatsapp" | "sms"; detail?: string },
): Promise<void> {
  const { error } = await createAdminClient()
    .from("seller_digests")
    .insert({
      seller_account_id: seller.seller_account_id,
      period_start: periodStart,
      frequency,
      status: outcome.status,
      channel: outcome.channel ?? null,
      detail: outcome.detail?.slice(0, 300) ?? null,
    });
  // A duplicate means another run got here first; anything else is logged,
  // and the seller may get a second copy tomorrow at worst.
  if (error && error.code !== "23505") console.error("[digest] could not record a digest", error.message);
}

async function deliver(seller: DueSeller, text: string, template: WaTemplateCall) {
  try {
    const whatsapp = await sendWhatsAppTemplate(seller.contact_phone, template, {
      sellerAccountId: seller.seller_account_id,
    });
    if (whatsapp.delivered) return { status: "sent" as const, channel: "whatsapp" as const };
    const sms = await sendSms(seller.contact_phone, text);
    if (sms.delivered) return { status: "sent" as const, channel: "sms" as const };
    return { status: "failed" as const, detail: `whatsapp:${whatsapp.reason ?? "?"} sms:${sms.reason ?? "?"}` };
  } catch (error) {
    return { status: "failed" as const, detail: error instanceof Error ? error.message : "send failed" };
  }
}

export async function runSellerDigests(now = new Date()): Promise<DigestRunResult> {
  const admin = createAdminClient();
  const started = Date.now();
  const result: DigestRunResult = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const dashboardUrl = `${await appOrigin()}/dashboard`;

  for (const period of duePeriods(now)) {
    const periodStart = period.to.toISOString().slice(0, 10);
    let after: string | undefined;
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { data: due, error } = await admin.rpc("seller_digest_due", {
        p_frequency: period.frequency,
        p_period_start: periodStart,
        p_after: after,
        p_limit: PAGE,
      });
      if (error) throw new Error(`seller_digest_due failed: ${error.message}`);
      if (!due || due.length === 0) break;
      after = due[due.length - 1].seller_account_id;

      for (const seller of due) {
        result.considered += 1;
        if (!(await isFeatureEnabled("seller_digest", { sellerAccountId: seller.seller_account_id }))) {
          // Not recorded: when the flag reaches this seller, today still counts.
          continue;
        }
        const { data: rows, error: summaryError } = await admin.rpc("seller_digest_summary", {
          p_seller_account_id: seller.seller_account_id,
          p_from: period.from.toISOString(),
          p_to: period.to.toISOString(),
        });
        const row = rows?.[0];
        if (summaryError || !row) {
          await record(seller, periodStart, period.frequency, { status: "failed", detail: "summary unavailable" });
          result.failed += 1;
          continue;
        }
        const summary: DigestSummary = {
          ordersCount: row.orders_count,
          paidRevenueMinor: row.paid_revenue_minor,
          toFulfil: row.to_fulfil,
          unreadConversations: row.unread_conversations,
        };
        if (!isWorthSending(summary)) {
          await record(seller, periodStart, period.frequency, { status: "skipped", detail: "nothing to report" });
          result.skipped += 1;
          continue;
        }
        const content = { shopName: seller.shop_name, label: period.label, summary, currency: seller.currency, dashboardUrl };
        const outcome = await deliver(seller, digestText(content), digestTemplate(content));
        await record(seller, periodStart, period.frequency, outcome);
        if (outcome.status === "sent") result.sent += 1;
        else result.failed += 1;
      }
      if (due.length < PAGE) break;
    }
  }
  return result;
}
