import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/notifications/email";
import { sendWhatsApp } from "@/lib/notifications/whatsapp";
import { appOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  let reminders = 0;
  let restocks = 0;

  const { data: abandoned } = await admin
    .from("abandoned_checkouts")
    .select("id,contact,cart_snapshot,campaign_token,shops(slug,display_name)")
    .is("reminded_at", null)
    .is("recovered_order_id", null)
    .eq("consent", true)
    .lte("remind_after", new Date().toISOString())
    .limit(50);
  for (const checkout of abandoned ?? []) {
    const shop = checkout.shops as unknown as { display_name: string; slug: string };
    const cart = encodeURIComponent(JSON.stringify(checkout.cart_snapshot));
    const campaign = checkout.campaign_token ? `&campaign=${encodeURIComponent(checkout.campaign_token)}` : "";
    const url = `${await appOrigin()}/${shop.slug}/checkout?cart=${cart}${campaign}`;
    try {
      const result = await sendEmail(checkout.contact, `Your cart at ${shop.display_name}`, `Your items are still waiting. Continue checkout: ${url}`);
      if (!result.delivered) throw new Error(result.reason);
      await admin.from("abandoned_checkouts").update({ reminded_at: new Date().toISOString() }).eq("id", checkout.id).is("reminded_at", null);
      reminders++;
    } catch { /* The next scheduled run retries undelivered reminders. */ }
  }

  const { data: requests } = await admin
    .from("restock_requests")
    .select("id,email,phone,products(id,name,inventory_policy,stock_quantity,reserved_quantity,shops(slug))")
    .is("notified_at", null)
    .eq("consent", true)
    .limit(100);
  for (const requestRow of requests ?? []) {
    const product = requestRow.products as unknown as { id: string; inventory_policy: string; name: string; reserved_quantity: number; stock_quantity: number | null; shops: { slug: string } };
    const available = product.inventory_policy !== "track" || (product.stock_quantity ?? 0) - product.reserved_quantity > 0;
    if (!available) continue;
    const url = `${await appOrigin()}/${product.shops.slug}/products/${product.id}`;
    try {
      const result = requestRow.email
        ? await sendEmail(requestRow.email, `${product.name} is back in stock`, `Good news — ${product.name} is available again: ${url}`)
        : await sendWhatsApp(requestRow.phone!, `Good news — ${product.name} is available again: ${url}`);
      if (!result.delivered) throw new Error(result.reason);
      await admin.from("restock_requests").update({ notified_at: new Date().toISOString() }).eq("id", requestRow.id).is("notified_at", null);
      restocks++;
    } catch { /* The next scheduled run retries undelivered alerts. */ }
  }

  return NextResponse.json({ reminders, restocks });
}

export const GET = POST;
