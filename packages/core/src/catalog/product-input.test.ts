import { describe, expect, it } from "vitest";
import {
  buildProductInsert,
  buildProductUpdate,
  buildVideoColumns,
  PRODUCT_UPDATABLE_COLUMNS,
  validateProductFields,
  type ProductFields,
} from "./product-input";

const NOW = "2026-08-07T10:00:00.000Z";

function fields(overrides: Partial<ProductFields> = {}): ProductFields {
  return {
    name: "Shea Butter",
    slug: "shea-butter",
    description: "Raw and unrefined",
    currency: "GHS",
    priceMinor: 5000,
    status: "draft",
    inventoryPolicy: "track",
    stockQuantity: 12,
    ...overrides,
  };
}

describe("buildProductUpdate", () => {
  /**
   * The bug this exists to prevent. `products` has a column-level UPDATE grant,
   * and shop_id is not in it — the mobile app sent it on every edit, so no
   * product could be saved from the phone.
   */
  it("emits only columns the UPDATE grant covers", () => {
    const payload = buildProductUpdate(fields(), NOW);

    for (const key of Object.keys(payload)) {
      expect(PRODUCT_UPDATABLE_COLUMNS).toContain(key);
    }
  });

  it.each(["shop_id", "seller_account_id", "updated_at", "moderation_status", "id"])(
    "never includes %s",
    (column) => {
      expect(buildProductUpdate(fields(), NOW)).not.toHaveProperty(column);
    },
  );

  it("stamps published_at when a product goes active", () => {
    expect(buildProductUpdate(fields({ status: "active" }), NOW).published_at).toBe(NOW);
  });

  // products_published_check only requires it when active, but leaving a stale
  // timestamp misreports when the product was live.
  it("clears published_at when a product is unpublished", () => {
    expect(buildProductUpdate(fields({ status: "draft" }), NOW).published_at).toBeNull();
    expect(buildProductUpdate(fields({ status: "archived" }), NOW).published_at).toBeNull();
  });

  // products_stock_check: stock_quantity is non-null iff policy is 'track'.
  it("nulls stock when not tracking, whatever the form held", () => {
    const payload = buildProductUpdate(
      fields({ inventoryPolicy: "continue_selling", stockQuantity: 40 }),
      NOW,
    );
    expect(payload.stock_quantity).toBeNull();
  });

  it("keeps stock when tracking", () => {
    expect(buildProductUpdate(fields({ stockQuantity: 0 }), NOW).stock_quantity).toBe(0);
  });

  it("normalises an empty sku to null rather than an empty string", () => {
    expect(buildProductUpdate(fields({ sku: "   " }), NOW).sku).toBeNull();
  });

  it("carries cost and video, which the form used to write separately", () => {
    const payload = buildProductUpdate(
      fields({ costMinor: 2000, videoUrl: "https://youtu.be/dQw4w9WgXcQ" }),
      NOW,
    );
    expect(payload.cost_minor).toBe(2000);
    expect(payload.video_provider).toBe("youtube");
  });
});

describe("buildProductInsert", () => {
  it("sets the scope columns UPDATE may not touch", () => {
    const payload = buildProductInsert(fields(), { shopId: "shop-1", sellerAccountId: "s-1" }, NOW);

    expect(payload.shop_id).toBe("shop-1");
    expect(payload.seller_account_id).toBe("s-1");
  });

  it("publishes immediately when created active", () => {
    const payload = buildProductInsert(
      fields({ status: "active" }),
      { shopId: "shop-1", sellerAccountId: "s-1" },
      NOW,
    );
    expect(payload.published_at).toBe(NOW);
  });
});

describe("validateProductFields", () => {
  it("accepts a well-formed product", () => {
    expect(validateProductFields(fields())).toBeNull();
  });

  it("rejects tracking stock without a quantity", () => {
    expect(validateProductFields(fields({ stockQuantity: null }))).toBe(
      "stock_required_when_tracking",
    );
  });

  it.each([
    ["equal to price", 5000],
    ["below price", 4000],
  ])("rejects a compare-at price %s", (_label, compareAtPriceMinor) => {
    expect(validateProductFields(fields({ compareAtPriceMinor }))).toBe(
      "compare_at_not_greater",
    );
  });

  it("accepts a compare-at price above price", () => {
    expect(validateProductFields(fields({ compareAtPriceMinor: 6000 }))).toBeNull();
  });

  it("rejects a negative cost", () => {
    expect(validateProductFields(fields({ costMinor: -1 }))).toBe("negative_cost");
  });
});

describe("buildVideoColumns", () => {
  // The table has a CHECK that (video_url is null) = (video_provider is null),
  // so these two can never be produced independently.
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://vimeo.com/123456789", "vimeo", "123456789"],
    ["https://www.tiktok.com/@ama/video/7", "tiktok", null],
    ["https://www.instagram.com/reel/xyz/", "instagram", null],
    ["https://example.com/clip.mp4", "other", null],
  ])("maps %s to %s", (url, provider, id) => {
    const columns = buildVideoColumns(url);
    expect(columns.video_url).toBe(url);
    expect(columns.video_provider).toBe(provider);
    expect(columns.video_id).toBe(id);
  });

  it.each([[null], [undefined], [""], ["   "]])("nulls both columns for %s", (input) => {
    const columns = buildVideoColumns(input);
    expect(columns.video_url).toBeNull();
    expect(columns.video_provider).toBeNull();
  });
});
