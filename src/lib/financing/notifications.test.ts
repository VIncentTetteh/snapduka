import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ existing: [] as unknown[], inserted: [] as unknown[], email: "seller@example.com" as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "notifications") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          limit: async () => ({ data: mocks.existing }),
          insert: async (rows: unknown[]) => {
            mocks.inserted.push(...rows);
            return { error: null };
          },
        };
        return chain;
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { contact_email: mocks.email } }) }) }) };
    },
  }),
}));

import { notifySellerOfFinancing } from "./notifications";

const event = (event_type: string, payload: Record<string, unknown>) => ({
  id: 42, aggregate: "financing", aggregate_id: "adv-1", event_type, payload: payload as never, attempts: 1,
});

beforeEach(() => {
  mocks.existing = [];
  mocks.inserted = [];
  mocks.email = "seller@example.com";
});

describe("notifySellerOfFinancing", () => {
  it("queues in-app and email messages when an advance arrives", async () => {
    await notifySellerOfFinancing(event("financing.disbursed", { sellerAccountId: "s1", principalMinor: 300000, currency: "GHS", advanceId: "adv-1" }));
    expect(mocks.inserted).toEqual([
      expect.objectContaining({ channel: "in_app", template: "financing_disbursed", payload: expect.objectContaining({ amountMinor: 300000, dedupeKey: "financing:42" }) }),
      expect.objectContaining({ channel: "email", recipient: "seller@example.com", template: "financing_disbursed" }),
    ]);
  });

  it("is idempotent on replay", async () => {
    mocks.existing = [{ id: "n1" }];
    await notifySellerOfFinancing(event("financing.repaid", { sellerAccountId: "s1" }));
    expect(mocks.inserted).toEqual([]);
  });

  it("sends in-app only when the seller has no email", async () => {
    mocks.email = null;
    await notifySellerOfFinancing(event("financing.repaid", { sellerAccountId: "s1" }));
    expect(mocks.inserted).toHaveLength(1);
  });
});
