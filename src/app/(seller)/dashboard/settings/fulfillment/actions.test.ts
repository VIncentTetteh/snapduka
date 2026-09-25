import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  upsert: vi.fn(),
  shop: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) =>
      table === "shops"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.shop() }) }) }) }
        : { upsert: mocks.upsert },
  }),
}));

import { savePickupAddress } from "./actions";

const SELLER = { kind: "seller", sellerAccountId: "seller-1", role: "owner", status: "active" };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.shop.mockReturnValue({ id: "shop-1", country: "GH" });
  mocks.upsert.mockResolvedValue({ error: null });
});

describe("savePickupAddress", () => {
  it("saves a normalised pickup address privately for the shop", async () => {
    await expect(
      savePickupAddress(form({ line1: "12 Oxford St", city: "Accra", digitalAddress: "ga 123 4567", contactPhone: "0241234567" })),
    ).rejects.toThrow(/saved=1/);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shop_id: "shop-1",
        seller_account_id: "seller-1",
        address: expect.objectContaining({ line1: "12 Oxford St", city: "Accra", country: "GH", geoSource: "digital_address" }),
      }),
      { onConflict: "shop_id" },
    );
  });

  it("refuses a malformed GhanaPostGPS code with a readable message", async () => {
    await expect(savePickupAddress(form({ line1: "x", city: "Accra", digitalAddress: "not-a-code" }))).rejects.toThrow(/error=/);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("requires a street and city", async () => {
    await expect(savePickupAddress(form({ line1: "", city: "" }))).rejects.toThrow(/error=Enter%20the%20street/);
  });

  it("refuses a team role without settings access", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "analyst" });
    await expect(savePickupAddress(form({ line1: "x", city: "y" }))).rejects.toThrow(/error=/);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
