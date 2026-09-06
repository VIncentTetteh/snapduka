import { describe, expect, it } from "vitest";

import { creatorUpdateTemplate, orderUpdateTemplate } from "./templates";

/**
 * The notification worker rendered every queued row with orderUpdateTemplate
 * regardless of its `template` column, so anything that was not an order came
 * out as "Order undefined is now undefined". Creator messages have no order
 * behind them at all.
 */
describe("creatorUpdateTemplate", () => {
  const base = { shopName: "PurePlatter Foods", portalUrl: "https://snapduka.test/creator" };

  it("names the shop in every message", () => {
    for (const event of [
      "creator_partnership_accepted",
      "creator_commission_earned",
      "creator_commission_payable",
      "creator_payment_recorded",
    ] as const) {
      const message = creatorUpdateTemplate({ ...base, event, amount: "GH₵ 40.00" });
      // A creator works with several shops; an unnamed one is not actionable.
      expect(`${message.subject} ${message.text}`).toContain("PurePlatter Foods");
    }
  });

  it("points a new partner at making their link", () => {
    const message = creatorUpdateTemplate({ ...base, event: "creator_partnership_accepted" });
    expect(message.text).toContain("/creator/links");
  });

  /**
   * The hold clock running out is not the money arriving. SnapDuka does not move
   * it — the seller does — so this is the creator's cue to expect a payment, not
   * a claim that one was sent.
   */
  it("says a matured commission is ready to be paid, not that it was paid", () => {
    const message = creatorUpdateTemplate({
      ...base,
      event: "creator_commission_payable",
      amount: "GH₵ 13.00",
    });

    expect(message.subject).toContain("GH₵ 13.00");
    expect(message.subject).toContain("ready to be paid");
    expect(`${message.subject} ${message.text}`).not.toMatch(/\bpaid you\b|\bhas been sent\b/);
  });

  it("states the amount earned", () => {
    const message = creatorUpdateTemplate({
      ...base,
      event: "creator_commission_earned",
      amount: "GH₵ 40.00",
    });
    expect(message.subject).toContain("GH₵ 40.00");
  });

  /**
   * SnapDuka records the seller's assertion and does not move the money, so the
   * wording must not claim the money arrived — the creator is being asked to
   * confirm precisely because we cannot know.
   */
  it("says the shop claims to have paid, not that money arrived", () => {
    const message = creatorUpdateTemplate({
      ...base,
      event: "creator_payment_recorded",
      amount: "GH₵ 40.00",
    });
    expect(message.subject).toMatch(/says they paid/i);
    expect(message.text).toMatch(/confirm/i);
    expect(message.text).toContain("/creator/payments");
  });

  it("still renders an order update unchanged", () => {
    const message = orderUpdateTemplate({
      reference: "SD-123",
      status: "confirmed",
      trackingUrl: "https://snapduka.test/orders/tok",
    });
    expect(message.subject).toBe("Order SD-123: confirmed");
  });
});
