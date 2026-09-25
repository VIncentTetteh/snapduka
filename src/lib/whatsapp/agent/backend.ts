import "server-only";

import { formatMoney, type CurrencyCode } from "@snapduka/core";

import { appOrigin } from "@/lib/app-url";
import { quoteDelivery as quoteCourierDelivery } from "@/lib/couriers/aggregate";
import { createAdminClient } from "@/lib/supabase/admin";

import { toE164 } from "../config";
import type { ToolBackend, ToolProduct } from "./tools";

/**
 * The agent's tools against the real database, bound to one conversation.
 *
 * Every query filters by the conversation's seller explicitly: this runs on
 * the service-role client, so RLS is not behind it and the `.eq` on
 * seller_account_id is the whole tenant boundary. Every list is bounded — an
 * unbounded select is silently capped at db.max_rows, and a model does not
 * need more than a handful of rows anyway.
 */

export type AgentShop = {
  id: string;
  slug: string;
  slugCode: string;
  displayName: string;
  currency: CurrencyCode;
};

export type AgentBinding = {
  sellerAccountId: string;
  shop: AgentShop;
  /** E.164; the only buyer whose orders the agent may look up. */
  buyerPhone: string;
};

const SEARCH_LIMIT = 5;
const VARIANT_LIMIT = 20;

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price_minor: number;
  compare_at_price_minor: number | null;
  currency: CurrencyCode;
  inventory_policy: string;
  stock_quantity: number | null;
  reserved_quantity: number;
};

const PRODUCT_COLUMNS =
  "id,name,description,price_minor,compare_at_price_minor,currency,inventory_policy,stock_quantity,reserved_quantity";

function available(row: {
  inventory_policy: string;
  stock_quantity: number | null;
  reserved_quantity: number;
}): { available: boolean; quantity: number | null } {
  if (row.inventory_policy !== "track") return { available: true, quantity: null };
  const quantity = Math.max(0, (row.stock_quantity ?? 0) - row.reserved_quantity);
  return { available: quantity > 0, quantity };
}

function toToolProduct(row: ProductRow, withDescription = false): ToolProduct {
  return {
    id: row.id,
    name: row.name,
    priceMinor: row.price_minor,
    compareAtPriceMinor: row.compare_at_price_minor,
    currency: row.currency,
    price: formatMoney(row.price_minor, row.currency),
    ...(withDescription ? { description: row.description.slice(0, 600) } : {}),
    inStock: available(row).available,
  };
}

/** Words safe to put inside a PostgREST `or=` filter: letters and digits only. */
export function searchTerms(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 4);
}

export function createToolBackend(binding: AgentBinding): ToolBackend {
  const admin = createAdminClient();
  const { sellerAccountId, shop } = binding;

  const activeProducts = () =>
    admin
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("seller_account_id", sellerAccountId)
      .eq("shop_id", shop.id)
      .eq("status", "active")
      .neq("moderation_status", "hidden");

  async function loadProduct(productId: string): Promise<ProductRow | null> {
    const { data } = await activeProducts().eq("id", productId).maybeSingle();
    return data;
  }

  return {
    async searchCatalog(query) {
      const terms = searchTerms(query);
      if (terms.length === 0) return [];
      const { data, error } = await activeProducts()
        .or(terms.map((term) => `name.ilike.%${term}%`).join(","))
        .order("published_at", { ascending: false })
        .limit(SEARCH_LIMIT);
      if (error) throw new Error(`search failed: ${error.message}`);
      return (data ?? []).map((row) => toToolProduct(row));
    },

    async getProduct(productId) {
      const row = await loadProduct(productId);
      if (!row) return null;
      const { data: variants } = await admin
        .from("product_variants")
        .select("id,name,price_minor,inventory_policy,stock_quantity,reserved_quantity")
        .eq("product_id", productId)
        .eq("seller_account_id", sellerAccountId)
        .eq("active", true)
        .order("position")
        .limit(VARIANT_LIMIT);
      return {
        ...toToolProduct(row, true),
        variants: (variants ?? []).map((variant) => ({
          id: variant.id,
          name: variant.name,
          price: formatMoney(variant.price_minor ?? row.price_minor, row.currency),
          inStock: available(variant).available,
        })),
      };
    },

    async checkStock(productId, variantId) {
      const row = await loadProduct(productId);
      if (!row) return null;
      if (!variantId) return available(row);
      const { data: variant } = await admin
        .from("product_variants")
        .select("inventory_policy,stock_quantity,reserved_quantity")
        .eq("id", variantId)
        .eq("product_id", productId)
        .eq("seller_account_id", sellerAccountId)
        .eq("active", true)
        .maybeSingle();
      return variant ? available(variant) : null;
    },

    async quoteDelivery(area) {
      // Courier quotes (Squad C) when they answer; the seller's own methods
      // otherwise. A courier outage must never leave the buyer with nothing.
      try {
        const quote = await quoteCourierDelivery({
          shopId: shop.id,
          destination: { city: area ?? "", area },
        });
        if (quote.ok) {
          return {
            options: quote.options.slice(0, 6).map((option) => ({
              label: option.label,
              fee: formatMoney(option.feeMinor, option.currency),
              type: option.kind === "courier" ? "courier" : option.type,
            })),
          };
        }
      } catch (error) {
        console.error("[whatsapp/agent] courier quote failed; using the shop's own methods", error);
      }
      const { data } = await admin
        .from("fulfillment_methods")
        .select("name,type,fee_minor")
        .eq("shop_id", shop.id)
        .eq("seller_account_id", sellerAccountId)
        .eq("active", true)
        .order("position")
        .limit(10);
      return {
        options: (data ?? []).map((method) => ({
          label: method.name,
          fee: formatMoney(method.fee_minor, shop.currency),
          type: method.type,
        })),
      };
    },

    async createCheckoutLink(productId) {
      const row = await loadProduct(productId);
      if (!row) return null;
      // One tracked link per (shop, product) on the whatsapp channel, reused
      // across conversations. Through /l/ so the click and the order are
      // attributed to the assistant — a bare product URL records neither.
      const token = `wa-${shop.slugCode}-${productId.replace(/-/g, "").slice(0, 10)}`;
      const { error } = await admin.from("campaign_links").upsert(
        {
          seller_account_id: sellerAccountId,
          shop_id: shop.id,
          name: `WhatsApp assistant: ${row.name}`.slice(0, 120),
          token,
          channel: "whatsapp",
          destination_path: `/${shop.slug}/products/${productId}`,
        },
        { onConflict: "token", ignoreDuplicates: true },
      );
      if (error) throw new Error(`checkout link failed: ${error.message}`);
      return { url: `${await appOrigin()}/l/${token}` };
    },

    async getOrderStatus(reference) {
      const { data: order } = await admin
        .from("orders")
        .select("public_reference,status,payment_status,fulfillment_status,tracking_token,buyer_snapshot")
        .eq("seller_account_id", sellerAccountId)
        .eq("public_reference", reference)
        .maybeSingle();
      const snapshot = order?.buyer_snapshot;
      const phone =
        snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot.phone === "string"
          ? toE164(snapshot.phone)
          : null;
      // Only the buyer who placed it: an order reference is printed on
      // receipts and screenshots, and is not proof of anything on its own.
      if (!order || phone !== binding.buyerPhone) return { found: false };
      return {
        found: true,
        reference: order.public_reference,
        status: order.status,
        fulfillment: order.fulfillment_status,
        payment: order.payment_status === "paid" ? "paid" : "not paid yet",
        trackingUrl: `${await appOrigin()}/orders/${order.tracking_token}`,
      };
    },
  };
}

/**
 * The catalogue summary for the cached system prompt: the shop's most recent
 * active products, one line each. Bounded at 40 — enough for the model to
 * recognise what the shop sells; `search_catalog` finds the rest.
 */
export async function catalogSummary(binding: AgentBinding): Promise<{ text: string; prices: string[] }> {
  const { data } = await createAdminClient()
    .from("products")
    .select("id,name,price_minor,currency")
    .eq("seller_account_id", binding.sellerAccountId)
    .eq("shop_id", binding.shop.id)
    .eq("status", "active")
    .neq("moderation_status", "hidden")
    .order("published_at", { ascending: false })
    .order("id")
    .limit(40);
  const rows = data ?? [];
  const prices = rows.map((row) => formatMoney(row.price_minor, row.currency));
  return {
    text: rows.map((row, index) => `${row.id} | ${row.name.replace(/\s+/g, " ").slice(0, 80)} | ${prices[index]}`).join("\n"),
    prices,
  };
}
