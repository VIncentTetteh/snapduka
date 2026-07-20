import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/restock", { method: "POST", body: JSON.stringify(body) });
}

function adminMock(product: { seller_account_id: string; country: string } | null) {
  const transformed = product ? { seller_account_id: product.seller_account_id, shops: { country: product.country } } : null;
  const maybeSingle = vi.fn().mockResolvedValue({ data: transformed });
  const eq3 = vi.fn().mockReturnValue({ maybeSingle });
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "products") return { select };
    if (table === "restock_requests") return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) }) }), insert };
    return {};
  });
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue({ ok: true });
});

describe("POST /api/restock", () => {
  it("rejects a phone number with the wrong digit count for the product's shop country", async () => {
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_account_id: "seller-1", country: "GH" }));

    const response = await POST(
      request({ consent: true, phone: "+23324123456", productId: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts a correctly-sized phone number for the product's shop country", async () => {
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_account_id: "seller-1", country: "GH" }));

    const response = await POST(
      request({ consent: true, phone: "+233241234567", productId: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(response.status).toBe(201);
  });

  it("still accepts a request with only an email (no phone to validate)", async () => {
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_account_id: "seller-1", country: "GH" }));

    const response = await POST(
      request({ consent: true, email: "buyer@example.com", productId: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(response.status).toBe(201);
  });
});
