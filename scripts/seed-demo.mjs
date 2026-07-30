/**
 * Seeds the "Sika Threads" demo shop onto the seller account for
 * +233542880528 — catalog, images, inventory, 90 days of orders, promotions,
 * campaigns and analytics.
 *
 *   pnpm seed:demo          # create or refresh the demo data
 *   pnpm seed:demo --purge  # remove it again, leaving the auth user in place
 *
 * Idempotent: every row uses a fixed id from demo-catalog.mjs, so re-running
 * updates in place rather than creating a second shop. Orders are generated
 * from a seeded PRNG for the same reason — the same run always produces the
 * same 90 days of history.
 *
 * Writes with the service role and therefore bypasses RLS. It is a demo
 * seeder, not a fixture for automated tests: tests/e2e/global-setup.ts still
 * owns deterministic e2e records.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  AUTH_USER_ID,
  CATEGORIES,
  CREATOR,
  COLLECTIONS,
  CUSTOMERS,
  FULFILLMENT,
  PRODUCTS,
  PROMOTIONS,
  SELLER_ID,
  SHOP_ID,
  SHOP_SLUG,
} from "./demo-catalog.mjs";

const ASSET_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "demo-assets");
const CURRENCY = "GHS";
const COUNTRY = "GH";
const ORDER_COUNT = 48;
const HISTORY_DAYS = 90;

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall through to the ambient environment (CI, `vercel env pull`).
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY — see .env.example.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so a re-run reproduces the same history. */
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const iso = (d) => d.toISOString();
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

async function must(label, promise) {
  const { error, data } = await promise;
  if (error) {
    console.error(`  ✗ ${label}: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
  console.log(`  ✓ ${label}`);
  return data;
}

const productBySlug = new Map(PRODUCTS.map((p) => [p.slug, p]));
const categoryBySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

/**
 * Mirrors the YouTube branch of src/lib/catalog/video.ts. Deliberately narrow:
 * a seeder only needs to turn a pasted link into the four product columns, and
 * products_video_url_provider_check requires url and provider to agree.
 */
function parseVideo(rawUrl) {
  const empty = { video_url: null, video_provider: null, video_id: null, video_thumbnail_url: null };
  if (!rawUrl) return empty;
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    console.warn(`  ! ignoring unparseable video url: ${rawUrl}`);
    return empty;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return empty;

  const pattern = /^[A-Za-z0-9_-]{11}$/;
  let id = null;
  if (url.hostname === "youtu.be") {
    const candidate = url.pathname.slice(1);
    if (pattern.test(candidate)) id = candidate;
  } else if (url.hostname.endsWith("youtube.com")) {
    const v = url.searchParams.get("v");
    const shorts = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})$/);
    if (v && pattern.test(v)) id = v;
    else if (shorts) id = shorts[1];
  }
  if (!id) {
    console.warn(`  ! not a recognised YouTube url, skipping video: ${rawUrl}`);
    return empty;
  }
  return {
    video_url: rawUrl,
    video_provider: "youtube",
    video_id: id,
    video_thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

async function purge() {
  console.log(`Purging demo data for shop ${SHOP_SLUG}…`);
  const { data: orders } = await db.from("orders").select("id").eq("shop_id", SHOP_ID);
  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length) {
    await db.from("order_events").delete().in("order_id", orderIds);
    await db.from("financial_events").delete().in("order_id", orderIds);
    // order_lines is protected by the order_lines_no_update trigger, and the
    // orders delete below cascades into it, so both fail while it is on.
    const { error } = await db.from("order_lines").delete().in("order_id", orderIds);
    if (error) {
      console.error(`\n  Cannot remove orders: ${error.message}`);
      console.error("  Sold-line snapshots are immutable by design. To purge them anyway, run:\n");
      console.error("    alter table order_lines disable trigger order_lines_no_update;");
      console.error(`    delete from order_lines where order_id in (select id from orders where shop_id = '${SHOP_ID}');`);
      console.error("    alter table order_lines enable trigger order_lines_no_update;\n");
      console.error("  Then re-run --purge. Everything else below is still being removed.");
    }
  }
  // Creator chain first: commissions reference orders and partnerships.
  await db.from("creator_commission_adjustments").delete().eq("seller_account_id", SELLER_ID);
  await db.from("creator_commissions").delete().eq("seller_account_id", SELLER_ID);
  await db.from("creator_commission_payments").delete().eq("seller_account_id", SELLER_ID);
  await db.from("creator_partnerships").delete().eq("seller_account_id", SELLER_ID);
  await db.from("creator_invitations").delete().eq("seller_account_id", SELLER_ID);
  await db.from("creators").delete().eq("id", CREATOR.id);

  // Ordered child-first so foreign keys never block the delete.
  for (const [table, column] of [
    ["analytics_events", "shop_id"],
    ["orders", "shop_id"],
    ["collection_products", "seller_account_id"],
    ["collections", "shop_id"],
    ["inventory_movements", "seller_account_id"],
    ["product_categories", null],
    ["product_media", "seller_account_id"],
    ["product_variants", "seller_account_id"],
    ["products", "shop_id"],
    ["promotions", "shop_id"],
    ["customers", "seller_account_id"],
    ["fulfillment_methods", "shop_id"],
    ["discovery_listings", "shop_id"],
    ["shop_branding", "shop_id"],
    ["seller_subscriptions", "seller_account_id"],
    ["payment_subaccounts", "seller_account_id"],
    ["seller_verifications", "seller_account_id"],
    ["shops", "id"],
    ["seller_accounts", "id"],
  ]) {
    if (table === "product_categories") {
      await db.from(table).delete().in("product_id", PRODUCTS.map((p) => p.id));
      continue;
    }
    const value = column === "id" ? (table === "shops" ? SHOP_ID : SELLER_ID) : column === "shop_id" ? SHOP_ID : SELLER_ID;
    await db.from(table).delete().eq(column, value);
  }
  for (const product of PRODUCTS) {
    const prefix = `${SELLER_ID}/${product.id}`;
    const { data: files } = await db.storage.from("product-images").list(prefix);
    if (files?.length) {
      await db.storage.from("product-images").remove(files.map((f) => `${prefix}/${f.name}`));
    }
  }
  console.log("Purged. The auth user for +233542880528 was left in place.");
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seedFoundation() {
  console.log("\nFoundation");
  await must(
    "seller account",
    db.from("seller_accounts").upsert({
      id: SELLER_ID,
      auth_user_id: AUTH_USER_ID,
      country: COUNTRY,
      status: "active",
      is_active: true,
      contact_name: "Ama Sika",
      contact_email: "hello@sikathreads.demo",
      contact_phone: "+233542880528",
      created_at: iso(daysAgo(118)),
    }),
  );

  await must(
    "shop",
    db.from("shops").upsert({
      id: SHOP_ID,
      seller_account_id: SELLER_ID,
      slug: SHOP_SLUG,
      display_name: "Sika Threads",
      legal_name: "Sika Threads Ltd",
      registration_number: "CS-2024-118842",
      country: COUNTRY,
      currency: CURRENCY,
      status: "published",
      published_at: iso(daysAgo(112)),
      created_at: iso(daysAgo(118)),
    }),
  );

  await must(
    "branding",
    db.from("shop_branding").upsert({
      shop_id: SHOP_ID,
      seller_account_id: SELLER_ID,
      accent_color: "#8C2F0D",
      surface_color: "#F4EDE2",
      font_family: "serif",
      hide_snapduka_branding: false,
    }),
  );

  await must(
    "fulfillment methods",
    db.from("fulfillment_methods").upsert(
      FULFILLMENT.map((f) => ({
        ...f,
        shop_id: SHOP_ID,
        seller_account_id: SELLER_ID,
        active: true,
        created_at: iso(daysAgo(112)),
      })),
    ),
  );

  await must(
    "discovery listing",
    db.from("discovery_listings").upsert({
      shop_id: SHOP_ID,
      seller_account_id: SELLER_ID,
      slug: SHOP_SLUG,
      display_name: "Sika Threads",
      country: COUNTRY,
      category: "Clothing",
      city: "Accra",
      description: "Hand-woven kente, wax print and Ghanaian craft, made within a day's drive of Accra.",
      quality_score: 88,
      active: true,
      refreshed_at: iso(new Date()),
    }),
  );
}

async function seedCatalog() {
  console.log("\nCatalog");
  await must("categories", db.from("categories").upsert(
    CATEGORIES.map((c) => ({ ...c, description: `${c.name} on SnapDuka`, active: true })),
  ));

  await must(
    "products",
    db.from("products").upsert(
      PRODUCTS.map((p) => ({
        id: p.id,
        shop_id: SHOP_ID,
        seller_account_id: SELLER_ID,
        name: p.name,
        slug: p.slug,
        description: p.description,
        currency: CURRENCY,
        price_minor: p.price_minor,
        compare_at_price_minor: p.compare_at_price_minor,
        cost_minor: p.cost_minor,
        sku: p.sku,
        status: p.status,
        inventory_policy: p.stock === null ? "continue_selling" : "track",
        stock_quantity: p.stock,
        reserved_quantity: 0,
        moderation_status: "clear",
        ...parseVideo(p.video_url),
        published_at: p.status === "active" ? iso(daysAgo(110)) : null,
        created_at: iso(daysAgo(111)),
      })),
    ),
  );

  const variants = PRODUCTS.flatMap((p) =>
    p.variants.map((v, index) => ({
      id: v.id,
      product_id: p.id,
      seller_account_id: SELLER_ID,
      name: v.name,
      sku: v.sku,
      price_minor: v.price_minor,
      inventory_policy: "track",
      stock_quantity: v.stock,
      reserved_quantity: 0,
      position: index,
      active: true,
      created_at: iso(daysAgo(110)),
    })),
  );
  await must("variants", db.from("product_variants").upsert(variants));

  await must(
    "product categories",
    db.from("product_categories").upsert(
      PRODUCTS.map((p) => ({ product_id: p.id, category_id: categoryBySlug.get(p.category).id })),
    ),
  );

  await must(
    "collections",
    db.from("collections").upsert(
      COLLECTIONS.map((c) => ({
        id: c.id,
        shop_id: SHOP_ID,
        seller_account_id: SELLER_ID,
        name: c.name,
        slug: c.slug,
        description: c.description,
        active: true,
      })),
    ),
  );

  await must(
    "collection products",
    db.from("collection_products").upsert(
      COLLECTIONS.flatMap((c) =>
        c.products.map((slug, position) => ({
          collection_id: c.id,
          product_id: productBySlug.get(slug).id,
          seller_account_id: SELLER_ID,
          position,
        })),
      ),
    ),
  );
}

async function seedImages() {
  console.log("\nImages");
  const rows = [];
  for (const product of PRODUCTS) {
    const body = await readFile(path.join(ASSET_DIR, product.media));
    // Content-addressed filename: the bucket is public and CDN-cached, so
    // re-uploading changed bytes to a fixed path keeps serving the stale image.
    const digest = createHash("sha256").update(body).digest("hex").slice(0, 12);
    const objectPath = `${SELLER_ID}/${product.id}/${digest}.png`;
    // Drop any previous render for this product so the bucket does not grow
    // an orphan per edit.
    const { data: stale } = await db.storage.from("product-images").list(`${SELLER_ID}/${product.id}`);
    const orphans = (stale ?? [])
      .filter((f) => f.name !== `${digest}.png`)
      .map((f) => `${SELLER_ID}/${product.id}/${f.name}`);
    if (orphans.length) await db.storage.from("product-images").remove(orphans);
    const { error } = await db.storage
      .from("product-images")
      .upload(objectPath, body, { contentType: "image/png", upsert: true });
    if (error) {
      console.error(`  ✗ upload ${product.media}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    rows.push({
      product_id: product.id,
      seller_account_id: SELLER_ID,
      object_path: objectPath,
      alt_text: `${product.name} — Sika Threads`,
      width: 800,
      height: 800,
      position: 0,
    });
  }
  console.log(`  ✓ uploaded ${rows.length} images`);
  // Replaced wholesale: product_media has no natural key to upsert on, so a
  // re-run would otherwise stack duplicate rows at position 0.
  await db.from("product_media").delete().eq("seller_account_id", SELLER_ID);
  await must("product media rows", db.from("product_media").insert(rows));
}

async function seedCustomers() {
  console.log("\nCustomers");
  await must(
    "customers",
    db.from("customers").upsert(
      CUSTOMERS.map((c, index) => ({
        ...c,
        seller_account_id: SELLER_ID,
        country: COUNTRY,
        created_at: iso(daysAgo(HISTORY_DAYS - index * 2)),
      })),
    ),
  );
}

/** Builds one order plus its lines, events and financial trail. */
function buildOrder(rand, index) {
  const created = daysAgo(Math.floor(rand() * HISTORY_DAYS));
  const customer = pick(rand, CUSTOMERS);
  const sellable = PRODUCTS.filter((p) => p.status === "active");
  const lineCount = rand() < 0.35 ? 2 : 1;
  const chosen = [];
  while (chosen.length < lineCount) {
    const product = pick(rand, sellable);
    if (!chosen.some((c) => c.id === product.id)) chosen.push(product);
  }

  const lines = chosen.map((product) => {
    const variant = product.variants.length ? pick(rand, product.variants) : null;
    const quantity = rand() < 0.8 ? 1 : 2;
    const unit = variant ? variant.price_minor : product.price_minor;
    return {
      product,
      variant,
      quantity,
      unit_price_minor: unit,
      line_total_minor: unit * quantity,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.line_total_minor, 0);
  const method = pick(rand, FULFILLMENT);
  const delivery = method.fee_minor;
  const discount = rand() < 0.22 ? Math.min(Math.round(subtotal * 0.15), subtotal) : 0;

  // Older orders are settled; the most recent few are still moving, so the
  // dashboard has something in every column.
  const ageDays = (Date.now() - created.getTime()) / 86_400_000;
  const roll = rand();
  let state;
  if (ageDays > 14) {
    state = roll < 0.06
      ? { status: "cancelled", payment_status: "unpaid", fulfillment_status: "cancelled", refund_status: "none" }
      : roll < 0.12
        ? { status: "completed", payment_status: "refunded", fulfillment_status: "returned", refund_status: "completed" }
        : { status: "completed", payment_status: "paid", fulfillment_status: "fulfilled", refund_status: "none" };
  } else if (ageDays > 4) {
    state = roll < 0.5
      ? { status: "completed", payment_status: "paid", fulfillment_status: "fulfilled", refund_status: "none" }
      : { status: "processing", payment_status: "paid", fulfillment_status: "dispatched", refund_status: "none" };
  } else {
    state = roll < 0.4
      ? { status: "confirmed", payment_status: "paid", fulfillment_status: "preparing", refund_status: "none" }
      : roll < 0.75
        ? { status: "pending", payment_status: "unpaid", fulfillment_status: "unconfirmed", refund_status: "none" }
        : { status: "processing", payment_status: "paid", fulfillment_status: "ready_for_pickup", refund_status: "none" };
  }

  const paymentMethod = method.type === "pickup" ? "pay_on_pickup" : rand() < 0.75 ? "paystack" : "cash_on_delivery";

  return {
    id: `aa000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    created,
    customer,
    lines,
    subtotal,
    discount,
    delivery,
    method,
    paymentMethod,
    ...state,
  };
}

async function seedOrders() {
  console.log("\nOrders");
  const rand = rng(20260728);
  const orders = Array.from({ length: ORDER_COUNT }, (_, i) => buildOrder(rand, i)).sort(
    (a, b) => a.created - b.created,
  );

  await must(
    "orders",
    db.from("orders").upsert(
      orders.map((o) => ({
        id: o.id,
        shop_id: SHOP_ID,
        seller_account_id: SELLER_ID,
        customer_id: o.customer.id,
        status: o.status,
        payment_status: o.payment_status,
        fulfillment_status: o.fulfillment_status,
        refund_status: o.refund_status,
        dispute_status: "none",
        currency: CURRENCY,
        subtotal_minor: o.subtotal,
        discount_minor: o.discount,
        delivery_minor: o.delivery,
        total_minor: o.subtotal - o.discount + o.delivery,
        payment_method: o.paymentMethod,
        fulfillment_method_snapshot: {
          id: o.method.id,
          name: o.method.name,
          type: o.method.type,
          feeMinor: o.method.fee_minor,
          instructions: o.method.instructions,
        },
        buyer_snapshot: {
          name: o.customer.name,
          email: o.customer.email,
          phone: o.customer.phone,
          address: { line1: "14 Oxford St", area: "Osu", city: "Accra", region: "Greater Accra" },
          country: COUNTRY,
          marketingConsent: true,
        },
        event_version: 4,
        created_at: iso(o.created),
        updated_at: iso(o.created),
      })),
    ),
  );

  // order_lines carries a BEFORE DELETE OR UPDATE trigger (order_lines_no_update)
  // that makes sold-line snapshots immutable, so the usual delete-then-insert
  // refresh is impossible by design. Insert only for orders that have no lines
  // yet — otherwise every re-run would stack another copy onto the same order.
  const { data: existingLines } = await db
    .from("order_lines")
    .select("order_id")
    .in("order_id", orders.map((o) => o.id));
  const alreadyLined = new Set((existingLines ?? []).map((r) => r.order_id));
  const ordersNeedingLines = orders.filter((o) => !alreadyLined.has(o.id));
  if (alreadyLined.size) {
    console.log(`  · ${alreadyLined.size} order(s) already have immutable lines — left untouched`);
  }

  await must(
    `order lines (${ordersNeedingLines.length} orders)`,
    db.from("order_lines").insert(
      ordersNeedingLines.flatMap((o) =>
        o.lines.map((l) => ({
          order_id: o.id,
          product_id: l.product.id,
          variant_id: l.variant?.id ?? null,
          product_name: l.product.name,
          variant_name: l.variant?.name ?? null,
          sku: l.variant?.sku ?? l.product.sku,
          unit_price_minor: l.unit_price_minor,
          unit_cost_minor: l.product.cost_minor,
          quantity: l.quantity,
          line_total_minor: l.line_total_minor,
          snapshot: {
            name: l.product.name,
            slug: l.product.slug,
            currency: CURRENCY,
            priceMinor: l.unit_price_minor,
            variantName: l.variant?.name ?? null,
          },
          created_at: iso(o.created),
        })),
      ),
    ),
  );

  await db.from("order_events").delete().in("order_id", orders.map((o) => o.id));
  await must(
    "order events",
    db.from("order_events").insert(
      orders.flatMap((o) => {
        const events = [
          { type: "order_placed", offsetMin: 0, visible: true },
        ];
        if (o.payment_status === "paid" || o.payment_status === "refunded") {
          events.push({ type: "payment_confirmed", offsetMin: 4, visible: true });
        }
        if (["preparing", "ready_for_pickup", "dispatched", "fulfilled", "returned"].includes(o.fulfillment_status)) {
          events.push({ type: "preparing", offsetMin: 90, visible: true });
        }
        if (["dispatched", "fulfilled", "returned"].includes(o.fulfillment_status)) {
          events.push({ type: "dispatched", offsetMin: 300, visible: true });
        }
        if (o.fulfillment_status === "fulfilled") {
          events.push({ type: "fulfilled", offsetMin: 1500, visible: true });
        }
        if (o.fulfillment_status === "cancelled") {
          events.push({ type: "cancelled", offsetMin: 120, visible: true });
        }
        if (o.refund_status === "completed") {
          events.push({ type: "refund_completed", offsetMin: 3000, visible: true });
        }
        return events.map((e) => ({
          order_id: o.id,
          seller_account_id: SELLER_ID,
          event_type: e.type,
          actor_type: e.type === "order_placed" ? "user" : "seller",
          buyer_visible: e.visible,
          data: {},
          created_at: iso(new Date(o.created.getTime() + e.offsetMin * 60_000)),
        }));
      }),
    ),
  );

  await db.from("financial_events").delete().in("order_id", orders.map((o) => o.id));
  await must(
    "financial events",
    db.from("financial_events").insert(
      orders
        .filter((o) => o.payment_status === "paid" || o.payment_status === "refunded")
        .flatMap((o) => {
          const total = o.subtotal - o.discount + o.delivery;
          const rows = [
            {
              order_id: o.id,
              event_type: "payment_captured",
              amount_minor: total,
              currency: CURRENCY,
              data: { method: o.paymentMethod },
              created_at: iso(new Date(o.created.getTime() + 4 * 60_000)),
            },
          ];
          if (o.refund_status === "completed") {
            rows.push({
              order_id: o.id,
              event_type: "refund_issued",
              amount_minor: total,
              currency: CURRENCY,
              data: { reason: "customer_changed_mind" },
              created_at: iso(new Date(o.created.getTime() + 3000 * 60_000)),
            });
          }
          return rows;
        }),
    ),
  );

  return orders;
}

async function seedInventory(orders) {
  console.log("\nInventory");
  const RESTOCK = 25;
  const SHRINKAGE_SLUG = "ankara-dress";
  const SHRINKAGE_QTY = -2;

  // Outbound movements are whatever actually happened, so opening stock is
  // solved backwards from them. Otherwise the ledger sums to a different
  // number than products.stock_quantity and the inventory page contradicts
  // itself.
  const outbound = new Map(PRODUCTS.map((p) => [p.id, 0]));
  const rows = [];

  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const line of order.lines) {
      outbound.set(line.product.id, outbound.get(line.product.id) - line.quantity);
      rows.push({
        product_id: line.product.id,
        variant_id: line.variant?.id ?? null,
        seller_account_id: SELLER_ID,
        quantity_delta: -line.quantity,
        reason: "sale",
        reference: order.id,
        created_at: iso(order.created),
      });
    }
  }

  const shrinkageProduct = productBySlug.get(SHRINKAGE_SLUG);
  outbound.set(shrinkageProduct.id, outbound.get(shrinkageProduct.id) + SHRINKAGE_QTY);
  rows.push({
    product_id: shrinkageProduct.id,
    seller_account_id: SELLER_ID,
    quantity_delta: SHRINKAGE_QTY,
    reason: "shrinkage",
    reference: "Damaged in transit",
    created_at: iso(daysAgo(21)),
  });

  for (const product of PRODUCTS) {
    if (product.stock === null) continue; // continue_selling: nothing to reconcile
    // opening + restock + outbound = current stock
    const opening = product.stock - RESTOCK - outbound.get(product.id);
    rows.push({
      product_id: product.id,
      seller_account_id: SELLER_ID,
      quantity_delta: opening,
      reason: "opening_stock",
      reference: "Initial intake",
      created_at: iso(daysAgo(110)),
    });
    rows.push({
      product_id: product.id,
      seller_account_id: SELLER_ID,
      quantity_delta: RESTOCK,
      reason: "restock",
      reference: "Bonwire workshop delivery",
      created_at: iso(daysAgo(38)),
    });
  }

  await db.from("inventory_movements").delete().eq("seller_account_id", SELLER_ID);
  await must(`${rows.length} inventory movements`, db.from("inventory_movements").insert(rows));
}

async function seedMarketing() {
  console.log("\nMarketing");
  await must(
    "promotions",
    db.from("promotions").upsert(
      PROMOTIONS.map((p) => ({
        id: p.id,
        seller_account_id: SELLER_ID,
        shop_id: SHOP_ID,
        code: p.code,
        name: p.name,
        kind: p.kind,
        value: p.value,
        minimum_minor: p.minimum_minor,
        redemption_limit: p.redemption_limit,
        per_customer_limit: p.per_customer_limit,
        active: p.active,
        starts_at: iso(daysAgo(p.starts_days_ago)),
        ends_at: iso(daysAgo(-p.ends_days_ahead)),
      })),
    ),
  );

  const rand = rng(913377);
  const sources = ["whatsapp", "instagram", "direct", "tiktok", "search"];
  const events = [];
  for (let day = HISTORY_DAYS; day >= 0; day--) {
    const views = 12 + Math.floor(rand() * 40);
    for (let i = 0; i < views; i++) {
      const product = pick(rand, PRODUCTS.filter((p) => p.status === "active"));
      const at = new Date(daysAgo(day).getTime() + Math.floor(rand() * 86_400_000));
      // Only these three pass analytics_event_type_check.
      const roll = rand();
      const eventType = roll < 0.34 ? "visit" : roll < 0.88 ? "product_view" : "checkout_start";
      events.push({
        // analytics_events.id has no database default — the app always supplies one.
        id: crypto.randomUUID(),
        seller_account_id: SELLER_ID,
        shop_id: SHOP_ID,
        session_id: crypto.randomUUID(),
        event_type: eventType,
        product_id: eventType === "visit" ? null : product.id,
        source: pick(rand, sources),
        country: COUNTRY,
        dimensions: {},
        created_at: iso(at),
      });
    }
  }
  await db.from("analytics_events").delete().eq("shop_id", SHOP_ID);
  // Chunked: a single insert of a few thousand rows trips PostgREST's payload limit.
  let inserted = 0;
  for (let i = 0; i < events.length; i += 500) {
    const chunk = events.slice(i, i + 500);
    const { error } = await db.from("analytics_events").insert(chunk);
    if (error) {
      console.error(`  ✗ analytics chunk at ${i}: ${error.message}`);
      process.exitCode = 1;
      break;
    }
    inserted += chunk.length;
  }
  // Report what actually landed, not what was planned.
  console.log(`  ${inserted === events.length ? "✓" : "✗"} ${inserted}/${events.length} analytics events`);
}


/**
 * Seeds the demo creator, their partnership and their tracked link, then walks
 * a few of the shop's existing paid orders through the commission engine so the
 * creator pages show real numbers instead of an empty state.
 *
 * The commission rows are produced by the accrual trigger rather than inserted
 * here — seeding them directly would let the demo drift from what the engine
 * actually does.
 */
async function seedCreator(orders) {
  console.log("\nCreator");

  // A creator is a distinct actor, so they need their own auth user.
  const { data: existing } = await db.auth.admin.listUsers();
  let authUserId = existing?.users?.find((user) => user.email === CREATOR.email)?.id;
  if (!authUserId) {
    const { data: created, error } = await db.auth.admin.createUser({
      email: CREATOR.email,
      email_confirm: true,
    });
    if (error) {
      console.error(`  ✗ creator auth user: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    authUserId = created.user.id;
  }
  console.log("  ✓ creator auth user");

  await must(
    "creator profile",
    db.from("creators").upsert({
      id: CREATOR.id,
      auth_user_id: authUserId,
      handle: CREATOR.handle,
      display_name: CREATOR.displayName,
      contact_email: CREATOR.email,
      contact_phone: CREATOR.contactPhone,
      country: CREATOR.country,
      status: "active",
      payout_details: { momoName: CREATOR.momoName },
    }),
  );

  await must(
    "partnership",
    db.from("creator_partnerships").upsert({
      id: CREATOR.partnershipId,
      seller_account_id: SELLER_ID,
      creator_id: CREATOR.id,
      status: "active",
      rate_bps: CREATOR.rateBps,
      hold_days: CREATOR.holdDays,
      currency: CURRENCY,
      accepted_at: iso(daysAgo(60)),
      invited_at: iso(daysAgo(62)),
    }),
  );

  await must(
    "creator link",
    db.from("campaign_links").upsert({
      id: CREATOR.linkId,
      seller_account_id: SELLER_ID,
      shop_id: SHOP_ID,
      name: `${CREATOR.displayName} · creator link`,
      token: CREATOR.linkToken,
      channel: "tiktok",
      destination_path: `/${SHOP_SLUG}`,
      creator_partnership_id: CREATOR.partnershipId,
      active: true,
    }),
  );

  // Clear the ledger before re-accruing. The accrual trigger inserts with
  // `on conflict (order_id) do nothing`, so any existing row — including one
  // already marked paid — would survive the bounce below and the lifecycle
  // states would accumulate instead of converging.
  await db.from("creator_commission_adjustments").delete().eq("creator_id", CREATOR.id);
  await db.from("creator_commissions").delete().eq("creator_id", CREATOR.id);
  await db.from("creator_commission_payments").delete().eq("creator_id", CREATOR.id);

  // Attribute a slice of the paid history to the creator, then let the trigger
  // do the arithmetic. Deterministic slice so re-runs stay stable.
  const attributable = orders
    .filter((order) => order.payment_status === "paid")
    .slice(0, 6);

  let accrued = 0;
  for (const order of attributable) {
    await db
      .from("orders")
      .update({
        campaign_snapshot: {
          id: CREATOR.linkId,
          name: `${CREATOR.displayName} · creator link`,
          token: CREATOR.linkToken,
          channel: "tiktok",
        },
      })
      .eq("id", order.id);

    // The accrual trigger fires on the unpaid -> paid edge, so bounce it.
    await db.from("orders").update({ payment_status: "unpaid" }).eq("id", order.id);
    const { error } = await db.from("orders").update({ payment_status: "paid" }).eq("id", order.id);
    if (!error) accrued += 1;
  }
  console.log(`  ✓ ${accrued} orders attributed to the creator`);

  // Mature four of six, then settle two of those, so the demo shows every
  // stage at once: on hold, ready to be paid, and paid-and-confirmed.
  const { data: commissions } = await db
    .from("creator_commissions")
    .select("id,amount_minor,currency")
    .eq("creator_id", CREATOR.id)
    .order("order_placed_at", { ascending: true });
  const matured = (commissions ?? []).slice(0, 4);
  if (matured.length) {
    await db
      .from("creator_commissions")
      .update({ payable_at: iso(daysAgo(1)) })
      .in("id", matured.map((row) => row.id));
    const { data: released } = await db.rpc("release_due_creator_commissions");
    console.log(`  ✓ ${released ?? 0} commissions released as payable`);
  }

  const settled = matured.slice(0, 2);
  if (settled.length) {
    // Written directly rather than through record_creator_commission_payment:
    // that function derives the seller from the caller's session, and the
    // seeder has no session. The resulting rows are identical.
    const amount = settled.reduce((sum, row) => sum + row.amount_minor, 0);
    const { data: payment, error } = await db
      .from("creator_commission_payments")
      .insert({
        seller_account_id: SELLER_ID,
        creator_id: CREATOR.id,
        amount_minor: amount,
        currency: CURRENCY,
        method: "mobile_money",
        external_reference: "MOMO-DEMO-8841",
        marked_by: AUTH_USER_ID,
        marked_at: iso(daysAgo(3)),
        // Confirmed by the creator, so the demo shows the trust loop closed
        // rather than a one-sided claim.
        confirmed_at: iso(daysAgo(2)),
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  ✗ recorded payment: ${error.message}`);
      process.exitCode = 1;
    } else {
      await db
        .from("creator_commissions")
        .update({ status: "paid", paid_at: iso(daysAgo(3)), payment_id: payment.id })
        .in("id", settled.map((row) => row.id));
      console.log(`  ✓ 1 payment recorded and confirmed (${settled.length} commissions)`);
    }
  }
}

async function main() {
  if (process.argv.includes("--purge")) {
    await purge();
    return;
  }
  console.log(`Seeding demo shop "${SHOP_SLUG}" for +233542880528`);
  await seedFoundation();
  await seedCatalog();
  await seedImages();
  await seedCustomers();
  const orders = await seedOrders();
  await seedInventory(orders);
  await seedMarketing();
  await seedCreator(orders);
  console.log(`\nDone. Storefront: /${SHOP_SLUG}`);
}

await main();
