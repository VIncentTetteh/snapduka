import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBuyer: vi.fn(),
  rateLimit: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
  update: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/buyer/guard", () => ({ requireBuyer: mocks.requireBuyer }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));

import { GET, POST } from "./route";

function client() {
  return {
    from: (table: string) =>
      table === "buyer_addresses"
        ? {
            insert: (row: unknown) => {
              mocks.insert(row);
              return { select: () => ({ single: mocks.single }) };
            },
            select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
          }
        : {
            update: (row: unknown) => {
              mocks.update(row);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          },
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/buyer/addresses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ ok: true });
  mocks.requireBuyer.mockResolvedValue({
    buyer: { kind: "buyer", buyerProfileId: "my-profile", userId: "u1", phone: "+233241234567", consented: true },
    client: client(),
  });
  mocks.single.mockResolvedValue({ data: { id: "a-new" }, error: null });
});

describe("/api/buyer/addresses", () => {
  it("passes the guard's refusal straight through", async () => {
    mocks.requireBuyer.mockResolvedValue(new Response(null, { status: 401 }));

    expect((await GET()).status).toBe(401);
    expect((await POST(post({ line1: "x", city: "Accra" }))).status).toBe(401);
  });

  it("writes to the session's profile, ignoring any profile id in the body", async () => {
    const response = await POST(post({ line1: "12 Oxford St", city: "Accra", buyer_profile_id: "someone-else" }));

    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ buyer_profile_id: "my-profile" }));
  });

  it("rejects an invalid address with field messages", async () => {
    const response = await POST(post({ line1: "", city: "" }));

    expect(response.status).toBe(422);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("stars the new address when asked", async () => {
    await POST(post({ line1: "12 Oxford St", city: "Accra", makeDefault: true }));

    expect(mocks.update).toHaveBeenCalledWith({ default_address_id: "a-new" });
  });

  it("explains a full address book instead of a 500", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "54000", message: "address book is full" } });

    const response = await POST(post({ line1: "12 Oxford St", city: "Accra" }));

    expect(response.status).toBe(409);
  });
});
