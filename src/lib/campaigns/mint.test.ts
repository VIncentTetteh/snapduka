import { describe, expect, it, vi } from "vitest";

import { mintChannelLinks } from "./mint";

/**
 * The one place that knows how a tracked link is shaped.
 *
 * Share Studio, the creator portal and publishing a shop all mint links, and
 * before this helper the first two carried their own copy of the loop. What
 * matters is not that they look alike but that they agree: the channel suffix is
 * part of the token a buyer clicks, so two minters disagreeing would give one
 * destination two competing link sets and split its attribution between them.
 */

type Row = { channel: string; token: string; creator_partnership_id: string | null };

/**
 * A Supabase stand-in that records the filters applied to the existence check,
 * because which rows that check can see is the whole behaviour under test.
 */
function client(existing: { channel: string }[]) {
  const filters: Record<string, unknown> = {};
  const inserted: Row[][] = [];

  const chain = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return chain;
    },
    is(column: string, value: unknown) {
      filters[column] = value;
      return chain;
    },
    then(resolve: (value: { data: { channel: string }[] }) => unknown) {
      return Promise.resolve(resolve({ data: existing }));
    },
  };

  return {
    filters,
    inserted,
    client: {
      from: vi.fn(() => ({
        select: () => chain,
        insert: async (rows: Row[]) => {
          inserted.push(rows);
          return { error: null };
        },
      })),
    } as never,
  };
}

describe("mintChannelLinks", () => {
  it("mints one link per channel from a single base token", async () => {
    const { client: supabase, inserted } = client([]);

    const result = await mintChannelLinks(supabase, {
      sellerAccountId: "seller-1",
      shopId: "shop-1",
      destinationPath: "/sika-threads",
      label: "Storefront",
    });

    expect(result).toEqual({ ok: true, created: 5 });
    const rows = inserted[0]!;
    // One base, one suffix each — that shape is what /l/ and campaign_link_totals
    // read, and what the mobile app must reproduce.
    const bases = new Set(rows.map((row) => row.token.split("-")[0]));
    expect(bases.size).toBe(1);
    expect(rows.map((row) => row.token.split("-")[1]).sort()).toEqual(["i", "o", "s", "t", "w"]);
  });

  it("skips channels that already exist rather than duplicating them", async () => {
    const { client: supabase, inserted } = client([
      { channel: "whatsapp" },
      { channel: "instagram" },
      { channel: "tiktok" },
      { channel: "snapchat" },
    ]);

    // This is what topping up an existing destination looks like after
    // SHARE_CHANNELS gained "other": only the missing one is created.
    const result = await mintChannelLinks(supabase, {
      sellerAccountId: "seller-1",
      shopId: "shop-1",
      destinationPath: "/sika-threads",
      label: "Storefront",
    });

    expect(result).toEqual({ ok: true, created: 1 });
    expect(inserted[0]!.map((row) => row.channel)).toEqual(["other"]);
  });

  it("does nothing when every channel is already minted", async () => {
    const { client: supabase, inserted } = client(
      ["whatsapp", "instagram", "tiktok", "snapchat", "other"].map((channel) => ({ channel })),
    );

    const result = await mintChannelLinks(supabase, {
      sellerAccountId: "seller-1",
      shopId: "shop-1",
      destinationPath: "/sika-threads",
      label: "Storefront",
    });

    expect(result).toEqual({ ok: true, created: 0 });
    expect(inserted).toHaveLength(0);
  });

  it("does not let a seller's links suppress a creator's for the same product", async () => {
    // A seller and a creator both mint for one product and the two sets are
    // separate. Matching on the destination alone would make whichever came
    // first silence the other — the creator would be told they already had
    // links when what exists is the seller's, and get none of their own.
    const { client: supabase, filters } = client([]);

    await mintChannelLinks(supabase, {
      sellerAccountId: "seller-1",
      shopId: "shop-1",
      destinationPath: "/sika-threads",
      label: "Akua",
      creatorPartnershipId: "partnership-1",
    });

    expect(filters.creator_partnership_id).toBe("partnership-1");
  });

  it("and a creator's do not suppress the seller's", async () => {
    const { client: supabase, filters } = client([]);

    await mintChannelLinks(supabase, {
      sellerAccountId: "seller-1",
      shopId: "shop-1",
      destinationPath: "/sika-threads",
      label: "Storefront",
    });

    expect(filters.creator_partnership_id).toBeNull();
  });

  it("reports the failure instead of leaving the caller with no links and no reason", async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                is: async () => ({ data: [] }),
              }),
            }),
          }),
        }),
        insert: async () => ({ error: { code: "23503", message: "foreign key" } }),
      })),
    } as never;

    const result = await mintChannelLinks(supabase, {
      sellerAccountId: "seller-1",
      shopId: "shop-1",
      destinationPath: "/sika-threads",
      label: "Storefront",
    });

    // Not a token collision, so retrying cannot help — surface it rather than
    // burning five attempts and returning silently.
    expect(result.ok).toBe(false);
  });
});
