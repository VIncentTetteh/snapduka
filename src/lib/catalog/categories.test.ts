import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(), limit: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));

import { loadCategoryOptions, MAX_CATEGORY_OPTIONS } from "./categories";

function supabase() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: mocks.limit,
  };
  return { from: vi.fn(() => chain), chain };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.limit.mockResolvedValue({ data: [{ id: "c1", name: "Beauty" }], error: null });
});

describe("loadCategoryOptions", () => {
  it("is empty, without a query, while product_categories is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    const client = supabase();
    await expect(loadCategoryOptions(client as never, "s1")).resolves.toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("product_categories", { sellerAccountId: "s1" });
  });

  it("reads active categories, bounded", async () => {
    const client = supabase();
    await expect(loadCategoryOptions(client as never, "s1")).resolves.toEqual([{ id: "c1", name: "Beauty" }]);
    expect(client.from).toHaveBeenCalledWith("categories");
    expect(client.chain.eq).toHaveBeenCalledWith("active", true);
    expect(mocks.limit).toHaveBeenCalledWith(MAX_CATEGORY_OPTIONS);
  });

  it("hides the field rather than failing the page when the read fails", async () => {
    mocks.limit.mockResolvedValue({ data: null, error: { code: "500" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadCategoryOptions(supabase() as never, "s1")).resolves.toEqual([]);
  });
});
