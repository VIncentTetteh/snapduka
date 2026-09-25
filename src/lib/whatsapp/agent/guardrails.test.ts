import { describe, expect, it } from "vitest";

import { checkReply, claimsPayment, moneyAmounts, unverifiedPrices } from "./guardrails";

describe("moneyAmounts", () => {
  it.each([
    ["It is GH₵120.00", [120]],
    ["That one na ₦12,500", [12500]],
    ["GHS 1,200.50 or 90 cedis", [1200.5, 90]],
    ["CFA 5,000", [5000]],
    ["size 42, 3 left", []],
  ])("%s", (text, expected) => {
    expect(moneyAmounts(text)).toEqual(expected);
  });
});

describe("unverifiedPrices", () => {
  const allowed = ["GH₵120.00", "GH₵35.00"];

  it("passes prices a tool returned", () => {
    expect(unverifiedPrices("The bag is GH₵120.00 and delivery GH₵35", allowed)).toEqual([]);
  });

  // Rounding or inventing a discount commits the seller to a price they never set.
  it("flags a rounded or invented price", () => {
    expect(unverifiedPrices("For you, GH₵100 only", allowed)).toEqual([100]);
  });
});

describe("claimsPayment", () => {
  it.each([
    "Your payment has been received, thank you!",
    "We have received your payment",
    "Payment confirmed",
    "You have paid successfully",
  ])("catches %s", (text) => {
    expect(claimsPayment(text)).toBe(true);
  });

  it("allows explaining how to pay", () => {
    expect(claimsPayment("You can pay with MoMo or card on the checkout page.")).toBe(false);
  });
});

describe("checkReply", () => {
  it("blocks a payment claim unless the order lookup confirmed it this turn", () => {
    expect(checkReply("Payment confirmed!", { allowedPriceTexts: [], paidOrderConfirmed: false })).toEqual({
      ok: false,
      violation: "payment_claim",
    });
    expect(checkReply("Payment confirmed!", { allowedPriceTexts: [], paidOrderConfirmed: true })).toEqual({ ok: true });
  });
});
