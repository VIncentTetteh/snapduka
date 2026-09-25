import { describe, expect, it } from "vitest";

import {
  WA_TEMPLATES,
  orderedTemplateParams,
  renderTemplateBody,
  storableTemplateBody,
  templateForOrderEvent,
} from "./templates";

describe("WhatsApp templates", () => {
  /**
   * Pinned: these bodies are what was submitted to Meta and what
   * 202609250121 seeded into wa_templates. Changing one here without a
   * resubmission makes every send of it fail at Meta.
   */
  it("matches the registry seed", () => {
    expect(WA_TEMPLATES.order_confirmed.body).toBe("Your order {{1}} from {{2}} is confirmed. Track it here: {{3}}");
    expect(WA_TEMPLATES.order_dispatched.body).toBe("Your order {{1}} from {{2}} is on its way. Track it here: {{3}}");
    expect(WA_TEMPLATES.delivery_code.body).toBe(
      "{{1}} is your SnapDuka delivery code for order {{2}}. Give it to the rider only when you have your order.",
    );
    expect(WA_TEMPLATES.payout_sent.body).toBe("SnapDuka has sent your payout of {{1}} to {{2}}. Reference: {{3}}");
    expect(WA_TEMPLATES.seller_digest.body).toBe(
      "SnapDuka summary for {{1}} ({{2}}): {{3}} new orders, {{4}} in paid sales. {{5}} to fulfil and {{6}} unread chats. Open your dashboard: {{7}}",
    );
  });

  it("orders parameters positionally", () => {
    expect(
      orderedTemplateParams({ name: "delivery_code", params: { reference: "SD-1", code: "123456" } }),
    ).toEqual(["123456", "SD-1"]);
  });

  it("refuses to send a template with a missing parameter", () => {
    expect(() => orderedTemplateParams({ name: "delivery_code", params: { code: "1" } })).toThrow(/reference/);
  });

  it("renders the body the recipient sees", () => {
    expect(
      renderTemplateBody({
        name: "order_confirmed",
        params: { reference: "SD-1", shop_name: "Ama", tracking_url: "https://x" },
      }),
    ).toBe("Your order SD-1 from Ama is confirmed. Track it here: https://x");
  });

  // The seller reads wa_messages in their inbox. A seller holding the buyer's
  // delivery code can confirm their own delivery.
  it("never stores the delivery code", () => {
    const stored = storableTemplateBody({ name: "delivery_code", params: { code: "482913", reference: "SD-1" } });
    expect(stored).not.toContain("482913");
    expect(stored).toContain("SD-1");
  });

  it("keeps delivery_code buyer-only", () => {
    expect(WA_TEMPLATES.delivery_code.audience).toBe("buyer");
    expect(WA_TEMPLATES.delivery_code.storeBody).toBe(false);
  });

  it("maps order events without inventing a template for the rest", () => {
    expect(templateForOrderEvent({ status: "dispatched", reference: "R", trackingUrl: "u" })?.name).toBe(
      "order_dispatched",
    );
    expect(templateForOrderEvent({ status: "completed", reference: "R", trackingUrl: "u" })).toBeNull();
  });
});
