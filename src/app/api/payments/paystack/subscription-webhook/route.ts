import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { mapPaystackSubscriptionEvent } from "@/lib/billing/subscriptions";
import { verifyPaystackWebhook } from "@/lib/payments/webhook";
import type { Database } from "@snapduka/core";

type SubscriptionUpdate = Database["public"]["Tables"]["seller_subscriptions"]["Update"];
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = request.headers.get("x-paystack-signature") ?? "";
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!secret || !verifyPaystackWebhook(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const payload = JSON.parse(new TextDecoder().decode(raw));
  const nextState = mapPaystackSubscriptionEvent(payload.event);
  if (!nextState) return NextResponse.json({ received: true });
  const providerCode = payload.data?.subscription_code;
  if (typeof providerCode !== "string") return NextResponse.json({ error: "Invalid event." }, { status: 400 });

  const admin = createAdminClient();
  const SUBSCRIPTION_COLUMNS =
    "id,seller_account_id,state,pending_change_type,pending_plan_id,pending_plan_version,pending_price_id";
  let { data: subscription } = await admin.from("seller_subscriptions").select(SUBSCRIPTION_COLUMNS).eq("provider_subscription_code", providerCode).maybeSingle();
  if (!subscription && payload.event === "subscription.create") {
    const email = payload.data?.customer?.email;
    const planCode = payload.data?.plan?.plan_code;
    if (typeof email === "string" && typeof planCode === "string") {
      const [{ data: seller }, { data: price }] = await Promise.all([
        admin.from("seller_accounts").select("id").eq("contact_email", email.toLowerCase()).maybeSingle(),
        admin.from("plan_prices").select("id").eq("provider_plan_code", planCode).maybeSingle(),
      ]);
      if (seller && price) {
        const { data: matched } = await admin
          .from("seller_subscriptions")
          .select(SUBSCRIPTION_COLUMNS)
          .eq("seller_account_id", seller.id)
          .or(`price_id.eq.${price.id},pending_price_id.eq.${price.id}`)
          .maybeSingle();
        subscription = matched;
        if (subscription) {
          await admin.from("seller_subscriptions").update({ provider_subscription_code: providerCode, provider_customer_code: payload.data?.customer?.customer_code ?? null, provider_email_token: payload.data?.email_token ?? null }).eq("id", subscription.id);
        }
      }
    }
  }
  if (!subscription) return NextResponse.json({ received: true, applied: false });
  const eventKey = String(payload.data?.id ?? createHash("sha256").update(raw).digest("hex"));
  const { error } = await admin.from("subscription_events").insert({
    subscription_id: subscription.id,
    seller_account_id: subscription.seller_account_id,
    event_key: eventKey,
    event_type: payload.event,
    payload,
  });
  if (error?.code === "23505") return NextResponse.json({ received: true, applied: false });
  if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });

  const nowIso = new Date().toISOString();

  if (nextState === "cancelled") {
    // A pending scheduled change (set by changePlan) already disabled this
    // subscription on purpose — the daily apply-plan-changes cron is the
    // sole authority for that state transition once current_period_end
    // passes. Only record cancellation here when Paystack-side cancellation
    // was NOT solicited by us (e.g. the seller cancelled directly with
    // their bank, or an operator acted outside this app).
    const { data: current } = await admin
      .from("seller_subscriptions")
      .select("pending_change_type")
      .eq("id", subscription.id)
      .maybeSingle();
    // Only a change WE scheduled explains a solicited disable. A pending
    // upgrade has not disabled anything yet, so a disable arriving during one
    // is a genuine external cancellation and must still be recorded.
    if (current?.pending_change_type === "downgrade" || current?.pending_change_type === "cancel") {
      return NextResponse.json({ received: true, applied: true, pending: true });
    }
    await admin
      .from("seller_subscriptions")
      .update({ state: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
      .eq("id", subscription.id);
    return NextResponse.json({ received: true, applied: true });
  }

  const update: SubscriptionUpdate = { state: nextState, updated_at: nowIso };
  if (nextState === "past_due") update.grace_ends_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
  if (nextState === "active") {
    update.grace_ends_at = null;
    const nextPaymentDate = payload.data?.next_payment_date ?? payload.data?.subscription?.next_payment_date;
    if (typeof nextPaymentDate === "string" && !Number.isNaN(new Date(nextPaymentDate).getTime())) {
      update.current_period_end = new Date(nextPaymentDate).toISOString();
    }
    const authorizationCode = payload.data?.authorization?.authorization_code;
    if (typeof authorizationCode === "string") update.provider_authorization_code = authorizationCode;
    const customerCode = payload.data?.customer?.customer_code;
    if (typeof customerCode === "string") update.provider_customer_code = customerCode;

    // The webhook can beat the browser back from Paystack. Promoting here too
    // means the seller lands on the plan they paid for either way, and the
    // event_key insert above keeps it from being applied twice.
    if (subscription.pending_change_type === "upgrade") {
      update.plan_id = subscription.pending_plan_id ?? undefined;
      update.plan_version = subscription.pending_plan_version ?? undefined;
      update.price_id = subscription.pending_price_id ?? undefined;
      update.pending_change_type = null;
      update.pending_plan_id = null;
      update.pending_plan_version = null;
      update.pending_price_id = null;
    }
  }
  await admin.from("seller_subscriptions").update(update).eq("id", subscription.id);
  return NextResponse.json({ received: true, applied: true });
}
