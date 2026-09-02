import { describe, expect, it } from "vitest";

import { normalizePhone } from "@/lib/i18n";

// Regression: ISSUE-008 — the product page told buyers to "Message the seller
// on WhatsApp" as plain text, with no link and no number, on the one product
// whose whole positioning is WhatsApp-native commerce.
// Found by /qa on 2026-09-01
// Report: .gstack/qa-reports/qa-report-snapduka-2026-09-01.md

/** Mirrors the href the product page builds from shop_branding.whatsapp_number. */
function whatsappHref(number: string | null, shopName: string, productName: string, url: string) {
  if (!number) return null;
  return `https://wa.me/${number.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
    `Hi ${shopName}, I have a question about ${productName}: ${url}`,
  )}`;
}

const DB_CHECK = /^\+[1-9][0-9]{7,14}$/;

describe("storefront WhatsApp contact", () => {
  it("shows nothing when the seller has not opted in", () => {
    expect(whatsappHref(null, "Sika Threads", "Kente Weave Tote", "https://x.test/p")).toBeNull();
  });

  it("builds a wa.me link carrying the product the buyer is looking at", () => {
    const href = whatsappHref("+233201234567", "Sika Threads", "Kente Weave Tote", "https://x.test/p");
    expect(href).toContain("https://wa.me/233201234567");
    expect(href).toContain(encodeURIComponent("Kente Weave Tote"));
    expect(href).toContain(encodeURIComponent("https://x.test/p"));
  });

  it("strips the plus, which wa.me does not accept in the path", () => {
    expect(whatsappHref("+2348012345678", "S", "P", "u")).toContain("wa.me/2348012345678");
    expect(whatsappHref("+2348012345678", "S", "P", "u")).not.toContain("wa.me/+");
  });

  it("normalizes the local formats sellers actually type into what the column accepts", () => {
    // The DB CHECK constraint rejects anything else, so normalizePhone and the
    // constraint have to agree or saving silently 500s.
    expect(normalizePhone("024 123 4567", "GH")).toBe("+233241234567");
    expect(normalizePhone("0801 234 5678", "NG")).toBe("+2348012345678");
    for (const input of ["024 123 4567", "+233 24 123 4567", "0241234567"]) {
      expect(normalizePhone(input, "GH")).toMatch(DB_CHECK);
    }
  });
});
