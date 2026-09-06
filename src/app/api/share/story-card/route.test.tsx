import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  resolveCreatorContext: vi.fn(),
  createRequestScopedClient: vi.fn(),
  appHost: vi.fn(async () => "snapduka.vercel.app"),
  toDataURL: vi.fn(async () => "data:image/png;base64,QR"),
  ImageResponse: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({
  resolveServerActor: mocks.resolveServerActor,
  resolveCreatorContext: mocks.resolveCreatorContext,
}));
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

type LinkRow = { token: string; channel?: string };

/**
 * A chain that answers however the route happens to walk it — the route filters
 * campaign_links differently for a campaign, a seller and a creator, and the
 * shape of that walk is not what these tests are about.
 */
function chain(rows: LinkRow[], filters: Record<string, unknown> = {}) {
  const link = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return link;
    },
    is(column: string, value: unknown) {
      filters[column] = value;
      return link;
    },
    order: () => link,
    limit: () => link,
    maybeSingle: async () => ({ data: rows[0] ?? null }),
    then(resolve: (value: { data: LinkRow[] }) => unknown) {
      return Promise.resolve(resolve({ data: rows }));
    },
  };
  return link;
}

function client(options: {
  campaign?: { name: string; creative_path: string | null } | null;
  token?: string | null;
  destinationLinks?: LinkRow[];
  partnership?: { id: string; seller_account_id: string; status: string } | null;
  product?: { name: string; price_minor: number; currency: string } | null;
  filters?: Record<string, unknown>;
}) {
  const {
    campaign = null,
    token = null,
    destinationLinks = [],
    partnership = null,
    product = null,
    filters = {},
  } = options;
  return {
    from(table: string) {
      if (table === "shops") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: SHOP }) }) }) };
      }
      if (table === "campaigns") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: campaign }) }) }) };
      }
      if (table === "creator_partnerships") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: partnership }) }) }),
        };
      }
      if (table === "products") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: product }) }) }),
          }),
        };
      }
      if (table === "campaign_links") {
        // The campaign branch reads one row; the destination branch reads a
        // page of them and picks "other".
        return { select: () => chain(token ? [{ token }] : destinationLinks, filters) };
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
  mocks.resolveCreatorContext.mockResolvedValue(null);
  mocks.createRequestScopedClient.mockResolvedValue(client({}));
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/share/story-card", () => {
  it("refuses anyone who is neither a seller nor a partnered creator", async () => {
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
  it("points a product card's QR at that product's tracked link", async () => {
    // A card requested for one product used to QR the shop homepage: the
    // most-posted artifact in the product did not open the thing it pictured,
    // and every scan arrived unattributed.
    mocks.createRequestScopedClient.mockResolvedValue(
      client({
        product: { name: "Pure Grain Rice 5kg", price_minor: 12000, currency: "GHS" },
        destinationLinks: [
          { token: "6v9r5w-w", channel: "whatsapp" },
          { token: "6v9r5w-o", channel: "other" },
        ],
      }),
    );

    await GET(request("product=prod-1"));

    // "other" specifically: it is the channel these cards go out through.
    expect(mocks.toDataURL).toHaveBeenCalledWith(
      "https://snapduka.vercel.app/l/6v9r5w-o",
      expect.anything(),
    );
  });

  it("falls back to the product page, not the shop, when nothing is minted", async () => {
    mocks.createRequestScopedClient.mockResolvedValue(
      client({ product: { name: "Pure Grain Rice 5kg", price_minor: 12000, currency: "GHS" } }),
    );

    await GET(request("product=prod-1"));

    expect(mocks.toDataURL).toHaveBeenCalledWith(
      "https://snapduka.vercel.app/pureplatter-foods-ltd/products/prod-1",
      expect.anything(),
    );
  });

  it("gives a partnered creator a card for the shop, stamped with their own link", async () => {
    // The creator's whole job is posting, and the only ready-to-post image in
    // the product was seller-only. The token has to be theirs: a shop's own
    // link would credit the sale to the shop and earn the creator nothing.
    const filters: Record<string, unknown> = {};
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: true });
    mocks.resolveCreatorContext.mockResolvedValue({ creatorId: "creator-1" });
    mocks.createRequestScopedClient.mockResolvedValue(
      client({
        partnership: { id: "p-1", seller_account_id: "seller-1", status: "active" },
        destinationLinks: [{ token: "akua-o", channel: "other" }],
        filters,
      }),
    );

    await GET(request("partnership=p-1"));

    expect(filters.creator_partnership_id).toBe("p-1");
    expect(mocks.toDataURL).toHaveBeenCalledWith(
      "https://snapduka.vercel.app/l/akua-o",
      expect.anything(),
    );
  });

  it("refuses a creator whose partnership is paused", async () => {
    // A paused partnership earns nothing, so it should not be producing posts.
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: true });
    mocks.resolveCreatorContext.mockResolvedValue({ creatorId: "creator-1" });
    mocks.createRequestScopedClient.mockResolvedValue(
      client({ partnership: { id: "p-1", seller_account_id: "seller-1", status: "paused" } }),
    );

    const response = await GET(request("partnership=p-1"));

    expect(response?.status).toBe(401);
  });

  it("refuses a partnership id that is not the caller's", async () => {
    // RLS returns nothing rather than erroring, so an id belonging to another
    // creator has to land on the same refusal as no id at all.
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: true });
    mocks.resolveCreatorContext.mockResolvedValue({ creatorId: "creator-1" });
    mocks.createRequestScopedClient.mockResolvedValue(client({ partnership: null }));

    const response = await GET(request("partnership=someone-elses"));

    expect(response?.status).toBe(401);
  });
});
