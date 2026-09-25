import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  bootstrapBuyerProfile,
  claimGuestOrders,
  exportBuyerData,
  listBuyerOrders,
  ORDER_PAGE_SIZE,
  requestBuyerDeletion,
  setSharedProfileConsent,
  type BuyerClient,
} from "./account";

function clientReturning(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as unknown as BuyerClient, rpc };
}

describe("buyer RPC wrappers", () => {
  it("parses a bootstrap result", async () => {
    const { client } = clientReturning({ status: "ok", created: true, profileId: "p1", phone: "+233241234567", consented: false });

    await expect(bootstrapBuyerProfile(client)).resolves.toMatchObject({ status: "ok", profileId: "p1" });
  });

  it("maps an unexpected bootstrap shape to an error rather than trusting it", async () => {
    const { client } = clientReturning({ status: "ok" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(bootstrapBuyerProfile(client)).resolves.toEqual({ status: "error" });
    log.mockRestore();
  });

  it("reports consent_required from a claim without consent", async () => {
    const { client } = clientReturning({ status: "consent_required", claimed: 0 });

    await expect(claimGuestOrders(client)).resolves.toEqual({ status: "consent_required", claimed: 0 });
  });

  it("sends the consent version only when granting", async () => {
    const { client, rpc } = clientReturning({ status: "ok", ordersUnlinked: 3 });

    await setSharedProfileConsent(client, false, "v9");

    expect(rpc).toHaveBeenCalledWith("set_buyer_shared_profile_consent", { p_granted: false, p_version: undefined });
  });

  it("pages order history by created_at keyset", async () => {
    const rows = Array.from({ length: ORDER_PAGE_SIZE }, (_, i) => ({
      order_id: `o${i}`,
      created_at: `2026-09-${String(25 - (i % 20)).padStart(2, "0")}T00:00:00Z`,
    }));
    const { client, rpc } = clientReturning(rows);

    const page = await listBuyerOrders(client, "2026-09-30T00:00:00Z");

    expect(rpc).toHaveBeenCalledWith("buyer_order_history", { p_before: "2026-09-30T00:00:00Z", p_limit: ORDER_PAGE_SIZE });
    expect(page?.nextBefore).toBe(rows[rows.length - 1].created_at);
  });

  it("has no next page when the last page is short", async () => {
    const { client } = clientReturning([{ order_id: "o1", created_at: "2026-09-01T00:00:00Z" }]);

    await expect(listBuyerOrders(client)).resolves.toMatchObject({ nextBefore: null });
  });

  it("returns null for an export that is not an object", async () => {
    const { client } = clientReturning(null);

    await expect(exportBuyerData(client)).resolves.toBeNull();
  });

  it("caps the deletion reason and reports success", async () => {
    const { client, rpc } = clientReturning({ status: "ok", ordersUnlinked: 0 });

    await expect(requestBuyerDeletion(client, "x".repeat(900))).resolves.toBe(true);
    expect(rpc.mock.calls[0][1].p_reason).toHaveLength(500);
  });
});
