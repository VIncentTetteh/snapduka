import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/notifications/email";
import { sendWhatsApp } from "@/lib/notifications/whatsapp";
import { appOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { paginate } from "@/lib/supabase/paginate";

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  let reminders = 0;
  let restocks = 0;

  // Was `.limit(50)` with no ordering. A reminder that fails to send keeps
  // `reminded_at` null, so it matches again next run — with fifty
  // permanently-undeliverable addresses at the head of an unordered read, no
  // other abandoned cart would ever be reminded. Paging by id visits every
  // eligible row each run, so a stuck one cannot starve the rest.
  const { rows: abandoned, error: abandonedError } = await paginate(
    (cursor, size) => {
      let page = admin
        .from("abandoned_checkouts")
        .select("id,contact,cart_snapshot,campaign_token,shops(slug,display_name)")
        .is("reminded_at", null)
        .is("recovered_order_id", null)
        .eq("consent", true)
        .lte("remind_after", new Date().toISOString())
        .order("id", { ascending: true })
        .limit(size);
      if (cursor) page = page.gt("id", cursor);
      return page;
    },
    (row) => row.id,
  );
  if (abandonedError) {
    console.error("[retention] failed to read abandoned checkouts", { error: abandonedError });
  }

  for (const checkout of abandoned) {
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

  // The sharper case. A request whose product is still unavailable is skipped
  // below and keeps `notified_at` null, so it matches every subsequent run
  // forever. With `.limit(100)` and no ordering, a hundred such rows at the
  // head filled the page on every run and every other restock alert — including
  // for products that had genuinely come back into stock — was never sent.
  // Nothing surfaced that: the job reported success each time.
  const { rows: requests, error: restockError } = await paginate(
    (cursor, size) => {
      let page = admin
        .from("restock_requests")
        .select("id,email,phone,products(id,name,inventory_policy,stock_quantity,reserved_quantity,shops(slug))")
        .is("notified_at", null)
        .eq("consent", true)
        .order("id", { ascending: true })
        .limit(size);
      if (cursor) page = page.gt("id", cursor);
      return page;
    },
    (row) => row.id,
  );
  if (restockError) {
    console.error("[retention] failed to read restock requests", { error: restockError });
  }

  for (const requestRow of requests) {
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
