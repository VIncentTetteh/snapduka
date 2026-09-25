import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  resolve: vi.fn(),
  profile: vi.fn(),
  addresses: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/buyer/session", () => ({ isBuyerAccountsEnabled: mocks.enabled }));
vi.mock("@/lib/auth/actor", () => ({ resolveBuyerActor: mocks.resolve }));
vi.mock("@/lib/supabase/request", () => ({
  createRequestScopedClient: vi.fn().mockResolvedValue({
    from: (table: string) =>
      table === "buyer_profiles"
        ? { select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }
        : { select: () => ({ eq: () => ({ order: () => ({ limit: mocks.addresses }) }) }) },
  }),
}));

import { GET } from "./route";

const buyer = {
  kind: "buyer",
  authenticated: true,
  userId: "u1",
  buyerProfileId: "p1",
  phone: "+233241234567",
  consented: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.resolve.mockResolvedValue(buyer);
  mocks.profile.mockResolvedValue({ data: { display_name: "Ama", default_address_id: "a1" }, error: null });
  mocks.addresses.mockResolvedValue({
    data: [
      {
        id: "a1", buyer_profile_id: "p1", label: "Home", line1: "12 Oxford St", area: "Osu", city: "Accra",
        region: "", country: "GH", digital_address: null, lat: null, lng: null, landmark: null,
        geo_source: "none", created_at: "", updated_at: "",
      },
    ],
    error: null,
  });
});

describe("GET /api/buyer/checkout-prefill", () => {
  it("answers signed-out for a guest, so checkout renders exactly as before", async () => {
    mocks.resolve.mockResolvedValue({ kind: "anonymous", authenticated: false });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: false, available: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("answers signed-out while the flag is off, without resolving anyone", async () => {
    mocks.enabled.mockResolvedValue(false);

    await expect((await GET()).json()).resolves.toEqual({ signedIn: false });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("answers signed-out when a seller (not a buyer) is signed in", async () => {
    mocks.resolve.mockResolvedValue({ kind: "unprovisioned", authenticated: true, userId: "u1", email: "s@x.com" });

    await expect((await GET()).json()).resolves.toEqual({ signedIn: false, available: true });
  });

  it("returns the buyer's own name, verified phone and saved addresses", async () => {
    const body = await (await GET()).json();

    expect(body).toMatchObject({
      signedIn: true,
      name: "Ama",
      phone: "+233241234567",
      defaultAddressId: "a1",
      addresses: [{ id: "a1", label: "Home", line1: "12 Oxford St", city: "Accra", country: "GH" }],
    });
    // The address list is the DeliveryAddress shape — no profile id leaks out.
    expect(body.addresses[0]).not.toHaveProperty("buyer_profile_id");
  });

  it("never fails checkout: a lookup error reads as signed-out", async () => {
    mocks.resolve.mockRejectedValue(new Error("auth down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: false });
    log.mockRestore();
  });
});
