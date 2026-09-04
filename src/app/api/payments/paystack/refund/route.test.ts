import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdminClient: vi.fn(),
  refund: vi.fn(),
  insert: vi.fn(),
  updates: [] as { table: string; values: Record<string, unknown> }[],
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/payments/paystack", () => ({
  paystackProvider: () => ({ refund: mocks.refund }),
}));

import { POST } from "./route";

/**
 * Refunding moves money out, so both of this route's defects mattered.
 *
 * The gate was `kind !== "seller" && kind !== "operator"` with no permission
 * check — and a team member resolves as `kind: "seller"` carrying the owner's
 * account id, so any role could refund. And Paystack was called before the
 * local row was written, with that insert's error discarded, so a lost write
 * left the same amount refundable a second time.
 */

const OWNER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "owner@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

const ORDER = {
  id: "order-1",
  seller_account_id: "seller-1",
  total_minor: 18_000,
  payment_status: "paid",
};

function admin(options: { priorRefunds?: { amount_minor: number }[]; insertError?: { code?: string } } = {}) {
  const { priorRefunds = [], insertError } = options;
  mocks.updates.length = 0;

  return {
    from(table: string) {
      if (table === "orders") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ORDER }) }) }) }),
          update: (values: Record<string, unknown>) => {
            mocks.updates.push({ table, values });
            return { eq: () => ({ eq: async () => ({ error: null }) }) };
          },
        };
      }
      if (table === "payment_attempts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [{ id: "att-1", reference: "ref-1" }] }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ neq: async () => ({ data: priorRefunds }) }) }),
        insert: (row: Record<string, unknown>) => {
          mocks.insert(row);
          return {
            select: () => ({
              single: async () =>
                insertError ? { data: null, error: insertError } : { data: { id: "ref-row-1" }, error: null },
            }),
          };
        },
        update: (values: Record<string, unknown>) => {
          mocks.updates.push({ table, values });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/payments/paystack/refund", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OWNER);
  mocks.createAdminClient.mockReturnValue(admin());
  mocks.refund.mockResolvedValue({ providerId: "rf_1", status: "pending" });
});

describe("POST /api/payments/paystack/refund", () => {
  it("refunds for an owner", async () => {
    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    expect(response.status).toBe(202);
    expect(mocks.refund).toHaveBeenCalledWith({ reference: "ref-1", amountMinor: 18_000 });
  });

  // The finding: analyst does not hold orders.manage, yet could refund.
  it("refuses roles that cannot manage orders", async () => {
    for (const role of ["analyst", "catalog"] as const) {
      mocks.createAdminClient.mockReturnValue(admin());
      mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role });

      const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

      expect(response.status, role).toBe(403);
    }
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("still allows a role that does manage orders", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role: "fulfillment" as const });

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    expect(response.status).toBe(202);
  });

  it("claims the amount locally before spending it at the provider", async () => {
    await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    // The row must exist, at a status the balance query counts, before the call.
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount_minor: 18_000, status: "requested" }),
    );
    expect(mocks.insert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refund.mock.invocationCallOrder[0],
    );
  });

  it("refuses a second in-flight refund rather than sending it twice", async () => {
    mocks.createAdminClient.mockReturnValue(admin({ insertError: { code: "23505" } }));

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    expect(response.status).toBe(409);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("releases the claim when the provider call fails", async () => {
    mocks.refund.mockRejectedValue(new Error("paystack down"));

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    expect(response.status).toBe(502);
    // `failed` is the one status the balance query excludes, so the amount
    // becomes refundable again rather than being stranded.
    expect(mocks.updates).toContainEqual({ table: "refunds", values: { status: "failed" } });
  });

  it("will not refund more than the unrefunded balance", async () => {
    mocks.createAdminClient.mockReturnValue(admin({ priorRefunds: [{ amount_minor: 18_000 }] }));

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    expect(response.status).toBe(409);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("refuses a caller who is neither seller nor operator", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: false });

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    expect(response.status).toBe(401);
  });
});
