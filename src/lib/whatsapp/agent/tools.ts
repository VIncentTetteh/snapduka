import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * The agent's tools. Pure: definitions plus an executor over a `ToolBackend`
 * interface. The server backend (./backend.ts) binds every call to the
 * conversation's seller and buyer; the eval harness binds a fixture catalogue.
 *
 * Nothing the model sends can widen that binding. No tool takes a seller id,
 * shop id or phone number — those come from the conversation, server-side — so
 * a buyer who talks the model into "check order SD-X for +233..." gets only
 * what their own phone is entitled to.
 */

export type ToolProduct = {
  id: string;
  name: string;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: string;
  /** Formatted for the buyer, e.g. "GH₵ 120.00". The only price text the model may repeat. */
  price: string;
  description?: string;
  inStock: boolean;
  variants?: { id: string; name: string; price: string; inStock: boolean }[];
};

export type ToolBackend = {
  searchCatalog(query: string): Promise<ToolProduct[]>;
  getProduct(productId: string): Promise<ToolProduct | null>;
  checkStock(productId: string, variantId?: string): Promise<{ available: boolean; quantity: number | null } | null>;
  quoteDelivery(area: string | undefined): Promise<{ options: { label: string; fee: string; type: string }[] }>;
  createCheckoutLink(productId: string): Promise<{ url: string } | null>;
  getOrderStatus(reference: string): Promise<
    | { found: true; reference: string; status: string; fulfillment: string; payment: string; trackingUrl: string }
    | { found: false }
  >;
};

export const MAX_TOOL_CALLS_PER_TURN = 8;

const productId = z.string().uuid();

const inputSchemas = {
  search_catalog: z.object({ query: z.string().trim().min(1).max(100) }),
  get_product: z.object({ product_id: productId }),
  check_stock: z.object({ product_id: productId, variant_id: z.string().uuid().optional() }),
  quote_delivery: z.object({ area: z.string().trim().max(100).optional() }),
  create_checkout_link: z.object({ product_id: productId }),
  get_order_status: z.object({ reference: z.string().trim().regex(/^SD-[A-Z0-9]{6,20}$/i) }),
  handoff_to_human: z.object({ reason: z.string().trim().min(1).max(200) }),
} as const;

export type ToolName = keyof typeof inputSchemas;

export const HANDOFF_TOOL: ToolName = "handoff_to_human";

/**
 * Tool definitions in a fixed order: tools render first in the request, so a
 * reordering would invalidate every cached prompt.
 */
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_catalog",
    description: "Search this shop's active products by words the buyer used. Returns up to 5 products with prices and stock.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Search words, e.g. 'black sneakers size 42'." } },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description: "Full details of one product from this shop, including variants and their prices.",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "string", description: "Product id from the catalogue or a search." } },
      required: ["product_id"],
    },
  },
  {
    name: "check_stock",
    description: "Whether a product (or one of its variants) is in stock right now.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        variant_id: { type: "string", description: "Optional variant id from get_product." },
      },
      required: ["product_id"],
    },
  },
  {
    name: "quote_delivery",
    description: "Delivery and pickup options with fees. Pass the buyer's area or city if they gave one.",
    input_schema: {
      type: "object",
      properties: { area: { type: "string", description: "Area or city, e.g. 'East Legon, Accra'." } },
    },
  },
  {
    name: "create_checkout_link",
    description: "A link the buyer opens to choose options, delivery and pay securely for one product.",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "get_order_status",
    description: "Status of an order this buyer placed, by its reference (looks like SD-XXXXXXXX). Only works for orders placed with this WhatsApp number.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
    },
  },
  {
    name: "handoff_to_human",
    description: "Pass the conversation to a person at the shop. Use for complaints, refunds, custom or bulk orders, a request for a person, or when unsure.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "One short sentence for the shop." } },
      required: ["reason"],
    },
  },
];

export type ToolOutcome = {
  content: string;
  isError: boolean;
  /** Price strings the tool returned — the only ones the reply may contain. */
  prices: string[];
  handoffReason?: string;
  /** Set when get_order_status confirmed a paid order for this buyer. */
  confirmedPaidOrder?: boolean;
};

function isToolName(name: string): name is ToolName {
  return name in inputSchemas;
}

function pricesOf(products: (ToolProduct | null)[]): string[] {
  return products.flatMap((product) =>
    product ? [product.price, ...(product.variants ?? []).map((variant) => variant.price)] : [],
  );
}

function ok(value: unknown, prices: string[] = []): ToolOutcome {
  return { content: JSON.stringify(value), isError: false, prices };
}

function error(message: string): ToolOutcome {
  return { content: JSON.stringify({ error: message }), isError: true, prices: [] };
}

export async function executeTool(name: string, rawInput: unknown, backend: ToolBackend): Promise<ToolOutcome> {
  if (!isToolName(name)) return error(`Unknown tool ${name}.`);
  const parsed = inputSchemas[name].safeParse(rawInput);
  if (!parsed.success) return error(`Invalid input: ${parsed.error.issues[0]?.message ?? "bad input"}`);

  try {
    switch (name) {
      case "search_catalog": {
        const input = inputSchemas.search_catalog.parse(parsed.data);
        const products = await backend.searchCatalog(input.query);
        return ok({ products }, pricesOf(products));
      }
      case "get_product": {
        const input = inputSchemas.get_product.parse(parsed.data);
        const product = await backend.getProduct(input.product_id);
        return product ? ok({ product }, pricesOf([product])) : error("No such product in this shop.");
      }
      case "check_stock": {
        const input = inputSchemas.check_stock.parse(parsed.data);
        const stock = await backend.checkStock(input.product_id, input.variant_id);
        return stock ? ok(stock) : error("No such product in this shop.");
      }
      case "quote_delivery": {
        const input = inputSchemas.quote_delivery.parse(parsed.data);
        const quote = await backend.quoteDelivery(input.area);
        return ok(quote, quote.options.map((option) => option.fee));
      }
      case "create_checkout_link": {
        const input = inputSchemas.create_checkout_link.parse(parsed.data);
        const link = await backend.createCheckoutLink(input.product_id);
        return link ? ok(link) : error("That product cannot be bought right now.");
      }
      case "get_order_status": {
        const input = inputSchemas.get_order_status.parse(parsed.data);
        const status = await backend.getOrderStatus(input.reference.toUpperCase());
        if (!status.found) return ok({ found: false, note: "No order with that reference for this WhatsApp number." });
        return { ...ok(status), confirmedPaidOrder: status.payment === "paid" };
      }
      case "handoff_to_human": {
        const input = inputSchemas.handoff_to_human.parse(parsed.data);
        return { ...ok({ handedOff: true }), handoffReason: input.reason };
      }
    }
  } catch (cause) {
    console.error(`[whatsapp/agent] tool ${name} failed`, cause);
    return error("That lookup failed. Offer to ask the shop instead.");
  }
}
