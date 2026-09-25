/**
 * Code-side definitions of the WhatsApp templates SnapDuka submits to Meta.
 *
 * `wa_templates` (202609250121) mirrors the same rows and records whether
 * Meta approved each one; this file is what code fills in. The two must agree
 * on name, language and parameter order — `templates.test.ts` pins the bodies so
 * an edit here is a deliberate resubmission, not a drive-by wording tweak that
 * Meta would reject at send time.
 *
 * Every template is English: Meta has no Twi or Pidgin templates. Local
 * languages happen in free-form messages inside the 24-hour window.
 */

export type WaTemplateName =
  | "order_confirmed"
  | "order_dispatched"
  | "delivery_code"
  | "payout_sent"
  | "seller_digest";

export type WaTemplateDefinition = {
  name: WaTemplateName;
  language: "en";
  category: "utility" | "marketing" | "authentication";
  /** `delivery_code` goes to the buyer only: it is what proves delivery. */
  audience: "buyer" | "seller";
  /** Parameter names in {{1}}, {{2}}... order. */
  parameters: readonly string[];
  body: string;
  /**
   * Whether the rendered body may be stored in `wa_messages`, which the seller
   * reads in their inbox. False for the delivery code: a seller who can read it
   * can confirm their own delivery and release the buyer's money.
   */
  storeBody: boolean;
};

export const WA_TEMPLATES: Record<WaTemplateName, WaTemplateDefinition> = {
  order_confirmed: {
    name: "order_confirmed",
    language: "en",
    category: "utility",
    audience: "buyer",
    parameters: ["reference", "shop_name", "tracking_url"],
    body: "Your order {{1}} from {{2}} is confirmed. Track it here: {{3}}",
    storeBody: true,
  },
  order_dispatched: {
    name: "order_dispatched",
    language: "en",
    category: "utility",
    audience: "buyer",
    parameters: ["reference", "shop_name", "tracking_url"],
    body: "Your order {{1}} from {{2}} is on its way. Track it here: {{3}}",
    storeBody: true,
  },
  delivery_code: {
    name: "delivery_code",
    language: "en",
    category: "utility",
    audience: "buyer",
    parameters: ["code", "reference"],
    body: "{{1}} is your SnapDuka delivery code for order {{2}}. Give it to the rider only when you have your order.",
    storeBody: false,
  },
  payout_sent: {
    name: "payout_sent",
    language: "en",
    category: "utility",
    audience: "seller",
    parameters: ["amount", "destination", "reference"],
    body: "SnapDuka has sent your payout of {{1}} to {{2}}. Reference: {{3}}",
    storeBody: true,
  },
  seller_digest: {
    name: "seller_digest",
    language: "en",
    category: "utility",
    audience: "seller",
    parameters: ["shop_name", "period", "orders", "revenue", "to_fulfil", "unread", "dashboard_url"],
    body: "SnapDuka summary for {{1}} ({{2}}): {{3}} new orders, {{4}} in paid sales. {{5}} to fulfil and {{6}} unread chats. Open your dashboard: {{7}}",
    storeBody: true,
  },
};

export type WaTemplateCall = {
  name: WaTemplateName;
  params: Record<string, string>;
};

/** Parameters in Meta's positional order; throws on a missing one. */
export function orderedTemplateParams(call: WaTemplateCall): string[] {
  const definition = WA_TEMPLATES[call.name];
  return definition.parameters.map((parameter) => {
    const value = call.params[parameter];
    if (value === undefined || value.trim() === "") {
      throw new Error(`WhatsApp template ${call.name} is missing parameter ${parameter}.`);
    }
    return value;
  });
}

/** The text the recipient sees, for the inbox and tests. */
export function renderTemplateBody(call: WaTemplateCall): string {
  const values = orderedTemplateParams(call);
  return WA_TEMPLATES[call.name].body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => values[Number(index) - 1] ?? "");
}

/**
 * What is stored in `wa_messages.body` for a template send. The delivery code
 * is replaced with a placeholder so it never reaches the seller's inbox.
 */
export function storableTemplateBody(call: WaTemplateCall): string {
  if (WA_TEMPLATES[call.name].storeBody) return renderTemplateBody(call);
  return `[Delivery code sent to the buyer for order ${call.params.reference ?? ""}]`.trim();
}

/** Order-notification events that map onto an approved utility template. */
const ORDER_EVENT_TEMPLATES: Record<string, WaTemplateName> = {
  order_placed: "order_confirmed",
  payment_succeeded: "order_confirmed",
  confirmed: "order_confirmed",
  dispatched: "order_dispatched",
  shipped: "order_dispatched",
  in_transit: "order_dispatched",
  out_for_delivery: "order_dispatched",
};

/**
 * The template to use for an order notification when the buyer is outside
 * the 24-hour window, or null when no template covers the event (then the
 * message can only go out while the window is open).
 */
export function templateForOrderEvent(input: {
  status: string;
  reference: string;
  trackingUrl: string;
  shopName?: string;
}): WaTemplateCall | null {
  const name = ORDER_EVENT_TEMPLATES[input.status];
  if (!name) return null;
  return {
    name,
    params: {
      reference: input.reference,
      tracking_url: input.trackingUrl,
      ...(input.shopName ? { shop_name: input.shopName } : {}),
    },
  };
}
