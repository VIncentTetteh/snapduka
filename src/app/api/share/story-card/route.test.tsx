import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createRequestScopedClient: vi.fn(),
  appHost: vi.fn(async () => "snapduka.vercel.app"),
  toDataURL: vi.fn(async () => "data:image/png;base64,QR"),
  ImageResponse: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/app-url", () => ({ appHost: mocks.appHost }));
vi.mock("@/lib/supabase/request", () => ({
  createRequestScopedClient: mocks.createRequestScopedClient,
}));
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.toDataURL } }));
// The renderer itself is not what is worth testing; what goes into it is.
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: unknown) {
      mocks.ImageResponse(element);
    }
  },
}));

import { GET } from "./route";

/**
 * The flyer.
 *
 * The property that matters is the QR: on a campaign flyer it has to encode the
 * campaign's tracked /l/ link, not the bare storefront. A flyer stuck on a wall
 * or shown at a stall is the one channel a seller cannot otherwise measure, and
 * a QR pointing at the storefront makes those scans anonymous.
 */

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

const SHOP = {
  slug: "pureplatter-foods-ltd",
  display_name: "PurePlatter Foods LTD",
  currency: "GHS",
  shop_branding: { logo_path: null },
};

function client(options: {
  campaign?: { name: string; creative_path: string | null } | null;
  token?: string | null;
}) {
  const { campaign = null, token = null } = options;
  return {
    from(table: string) {
      if (table === "shops") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: SHOP }) }) }) };
      }
      if (table === "campaigns") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: campaign }) }) }) };
      }
      if (table === "campaign_links") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: async () => ({ data: token ? { token } : null }) }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      };
    },
  };
}

function request(query = "") {
  return {
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as unknown as Parameters<typeof GET>[0];
}

/** The whole rendered tree, flattened to text, so headline copy is assertable. */
function renderedText(): string {
  return JSON.stringify(mocks.ImageResponse.mock.calls[0]?.[0] ?? {});
}

beforeEach(() => {
  vi.clearAllMocks();
  // publicMediaUrl resolves storage paths against this; without it every
  // background silently becomes null and the gradient fallback is used.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.supabase.co");
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.createRequestScopedClient.mockResolvedValue(client({}));
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/share/story-card", () => {
  it("refuses anyone who is not a seller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: false });

    const response = await GET(request());

    expect(response?.status).toBe(401);
  });

  it("points a plain card's QR at the storefront", async () => {
    await GET(request());

    expect(mocks.toDataURL).toHaveBeenCalledWith(
      "https://snapduka.vercel.app/pureplatter-foods-ltd",
      expect.anything(),
    );
  });

  it("points a campaign flyer's QR at the campaign's tracked link", async () => {
    mocks.createRequestScopedClient.mockResolvedValue(
      client({ campaign: { name: "December drop", creative_path: null }, token: "zsi6-s" }),
    );

    await GET(request("campaign=camp-1"));

    // The point of the whole feature: a scan off a printed flyer is credited to
    // the campaign rather than arriving as anonymous traffic.
    expect(mocks.toDataURL).toHaveBeenCalledWith(
      "https://snapduka.vercel.app/l/zsi6-s",
      expect.anything(),
    );
  });

  it("leads a campaign flyer with the campaign's name", async () => {
    mocks.createRequestScopedClient.mockResolvedValue(
      client({ campaign: { name: "December drop", creative_path: null }, token: "zsi6-s" }),
    );

    await GET(request("campaign=camp-1"));

    expect(renderedText()).toContain("December drop");
  });

  it("uses the campaign's own creative as the background", async () => {
    mocks.createRequestScopedClient.mockResolvedValue(
      client({
        campaign: { name: "December drop", creative_path: "seller-1/campaign-1.jpg" },
        token: "zsi6-s",
      }),
    );

    await GET(request("campaign=camp-1"));

    expect(renderedText()).toContain("campaign-media/seller-1/campaign-1.jpg");
  });

  it("falls back to the storefront when a campaign has no link yet", async () => {
    mocks.createRequestScopedClient.mockResolvedValue(
      client({ campaign: { name: "December drop", creative_path: null }, token: null }),
    );

    await GET(request("campaign=camp-1"));

    // Better a working flyer with an unattributed QR than a broken one.
    expect(mocks.toDataURL).toHaveBeenCalledWith(
      "https://snapduka.vercel.app/pureplatter-foods-ltd",
      expect.anything(),
    );
  });

  it("ignores a campaign that is not the caller's", async () => {
    // RLS returns nothing rather than erroring, so the card must degrade to a
    // plain storefront one instead of leaking or failing.
    mocks.createRequestScopedClient.mockResolvedValue(client({ campaign: null }));

    await GET(request("campaign=someone-elses"));

    expect(renderedText()).toContain("PurePlatter Foods LTD");
    expect(mocks.toDataURL).toHaveBeenCalledWith(
      "https://snapduka.vercel.app/pureplatter-foods-ltd",
      expect.anything(),
    );
  });
});
