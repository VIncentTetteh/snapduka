import { describe, expect, it } from "vitest";

import { formatPrice } from "./price";

// Regression: ISSUE-002 — the storefront carried four separate money
// formatters, so one product page showed "GHS 240.00" in the heading and
// "GH₵ 240" in the variant chips at the same time.
// Found by /qa on 2026-09-01
// Report: .gstack/qa-reports/qa-report-snapduka-2026-09-01.md

describe("formatPrice", () => {
  it("renders the local symbol rather than the ISO code", () => {
    expect(formatPrice(24000, "GHS")).toBe("GH₵ 240");
    expect(formatPrice(500000, "NGN")).toBe("₦ 5,000");
  });

  it("hides pesewas and kobo on whole amounts but keeps them when real", () => {
    expect(formatPrice(24000, "GHS")).toBe("GH₵ 240");
    expect(formatPrice(24050, "GHS")).toBe("GH₵ 240.50");
    expect(formatPrice(24099, "GHS")).toBe("GH₵ 240.99");
  });

  it("treats XOF as having no minor unit", () => {
    expect(formatPrice(12000, "XOF")).toBe("CFA 12,000");
  });

  it("groups thousands so large prices stay readable", () => {
    expect(formatPrice(125000000, "NGN")).toBe("₦ 1,250,000");
  });

  it("renders zero without a stray decimal", () => {
    expect(formatPrice(0, "GHS")).toBe("GH₵ 0");
  });
});
