import { describe, expect, it, vi } from "vitest";

import { checkDestination } from "./destination";

/**
 * Where a tracked link may point.
 *
 * Production held four links belonging to `sika-threads` whose destination was
 * `/sika-threads/products/<a product owned by pureplatter-foods-ltd>`. The
 * storefront filters a product by the shop in the path, so every one of them
 * 404'd — while /l/ still recorded the click against sika-threads.
 *
 * These are the cases that must not be mintable again.
 */

const SHOP = { slug: "sika-threads" };
const SELLER = "seller-1";
const OWN_PRODUCT = "e7aeeaa7-96c6-4553-8004-649870fea076";

/** `owns` decides whether the product lookup finds a row for this seller. */
function client(owns: boolean) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: owns ? { id: OWN_PRODUCT } : null }) }),
        }),
      }),
    })),
  } as never;
}

describe("checkDestination", () => {
  it("allows the seller's own storefront", async () => {
    const result = await checkDestination(client(true), SELLER, SHOP, "/sika-threads");

    expect(result).toEqual({ ok: true, path: "/sika-threads" });
  });

  it("allows a product the seller owns", async () => {
    const result = await checkDestination(
      client(true),
      SELLER,
      SHOP,
      `/sika-threads/products/${OWN_PRODUCT}`,
    );

    expect(result.ok).toBe(true);
  });

  // The exact shape of the four broken rows.
  it("refuses a product the seller does not own, even under their own slug", async () => {
    const result = await checkDestination(
      client(false),
      SELLER,
      SHOP,
      `/sika-threads/products/${OWN_PRODUCT}`,
    );

    expect(result).toEqual({ ok: false, reason: "foreign_product" });
  });

  it("refuses another seller's shop outright", async () => {
    const result = await checkDestination(
      client(true),
      SELLER,
      SHOP,
      `/pureplatter-foods-ltd/products/${OWN_PRODUCT}`,
    );

    expect(result).toEqual({ ok: false, reason: "foreign_shop" });
  });

  it("refuses another seller's storefront root", async () => {
    const result = await checkDestination(client(true), SELLER, SHOP, "/pureplatter-foods-ltd");

    expect(result.ok).toBe(false);
  });

  it("refuses the app root, which is the old column default", async () => {
    // '/' is what createCampaign used to fall back to, sending buyers to the
    // marketing site rather than the shop.
    const result = await checkDestination(client(true), SELLER, SHOP, "/");

    expect(result.ok).toBe(false);
  });

  it("refuses dashboard and API paths", async () => {
    for (const path of ["/dashboard/settings/billing", "/api/share/story-card", "/admin"]) {
      const result = await checkDestination(client(true), SELLER, SHOP, path);
      expect(result.ok, path).toBe(false);
    }
  });

  it("normalizes slashes so one destination is stored one way", async () => {
    // Otherwise the "does a link already exist for this destination" check
    // misses and mints a duplicate set.
    const result = await checkDestination(client(true), SELLER, SHOP, "sika-threads/");

    expect(result).toEqual({ ok: true, path: "/sika-threads" });
  });

  it("refuses a product path whose id is not a uuid", async () => {
    const result = await checkDestination(
      client(true),
      SELLER,
      SHOP,
      "/sika-threads/products/../../admin",
    );

    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
