import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeCursor } from "@/lib/api/keyset-cursor";
import { fakeAdmin, rowsWithSharedTimestamps } from "@/lib/api/testing";

const mocks = vi.hoisted(() => ({ authenticateApi: vi.fn() }));
vi.mock("@/lib/api-keys/auth", () => ({ authenticateApi: mocks.authenticateApi }));

import { GET as getCustomers } from "./customers/route";
import { GET as getOrders } from "./orders/route";
import { GET as getProducts } from "./products/route";

const SELLER = "seller-1";
const OTHER_SELLER = "seller-2";

type Handler = (request: Request) => Promise<Response>;
type Page = { data: { id: string; created_at: string }[]; nextCursor: string | null };

const ROUTES: [string, string, string, Handler][] = [
  ["orders", "orders", "orders:read", getOrders],
  ["customers", "customers", "customers:read", getCustomers],
  ["products", "products", "products:read", getProducts],
];

function call(handler: Handler, path: string, query: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/v1/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return handler(new Request(url, { headers: { authorization: "Bearer sk_test" } }));
}

async function readAll(handler: Handler, path: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const response = await call(handler, path, { limit: String(limit), ...(cursor ? { cursor } : {}) });
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;
    ids.push(...page.data.map((row) => row.id));
    cursor = page.nextCursor;
    if (!cursor) return ids;
    expect(typeof cursor).toBe("string");
  }
  throw new Error("pagination did not terminate");
}

describe.each(ROUTES)("GET /api/v1/%s", (path, table, scope, handler) => {
  let admin: ReturnType<typeof fakeAdmin>;
  const rows = [
    ...rowsWithSharedTimestamps(SELLER, 23, 3),
    // Another seller's rows interleave in time and id; they must never appear.
    ...rowsWithSharedTimestamps(OTHER_SELLER, 5, 2).map((row) => ({
      ...row,
      id: row.id.replace("00000000-0000-4000-8000", "ffffffff-0000-4000-8000"),
    })),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    admin = fakeAdmin({ [table]: rows });
    mocks.authenticateApi.mockResolvedValue({ admin, key: { seller_account_id: SELLER } });
  });

  it("requires its read scope", async () => {
    mocks.authenticateApi.mockResolvedValue(null);
    const response = await call(handler, path);
    expect(response.status).toBe(401);
    expect(mocks.authenticateApi).toHaveBeenCalledWith(expect.any(Request), scope);
  });

  it.each([1, 2, 3, 5, 7, 23, 50])(
    "returns every row exactly once, in (created_at, id) order, at page size %i",
    async (limit) => {
      const expected = rows
        .filter((row) => row.seller_account_id === SELLER)
        .sort((a, b) => (a.created_at + a.id < b.created_at + b.id ? -1 : 1))
        .map((row) => row.id);
      const seen = await readAll(handler, path, limit);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(23);
    },
  );

  it("still honours a legacy bare-id cursor by continuing after that row", async () => {
    const ordered = rows
      .filter((row) => row.seller_account_id === SELLER)
      .sort((a, b) => (a.created_at + a.id < b.created_at + b.id ? -1 : 1));
    const response = await call(handler, path, { limit: "100", cursor: ordered[9].id });
    const page = (await response.json()) as Page;
    expect(page.data.map((row) => row.id)).toEqual(ordered.slice(10).map((row) => row.id));
  });

  it("rejects a legacy cursor naming another seller's row", async () => {
    const foreign = rows.find((row) => row.seller_account_id === OTHER_SELLER)!;
    const response = await call(handler, path, { cursor: foreign.id });
    expect(response.status).toBe(400);
  });

  it.each(["not-a-cursor", "v2.!!!", encodeCursor({ createdAt: "yesterday", id: "x" })])(
    "rejects a malformed cursor (%s) with 400 instead of guessing",
    async (cursor) => {
      const response = await call(handler, path, { cursor });
      expect(response.status).toBe(400);
    },
  );

  it("clamps a garbage limit instead of sending NaN to PostgREST", async () => {
    const response = await call(handler, path, { limit: "abc" });
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;
    expect(page.data).toHaveLength(23);
    expect(page.nextCursor).toBeNull();
  });
});

describe("GET /api/v1/orders response shape", () => {
  it("includes event_version, the value POST /api/v1/fulfillment expects", async () => {
    const admin = fakeAdmin({ orders: rowsWithSharedTimestamps(SELLER, 1, 1) });
    mocks.authenticateApi.mockResolvedValue({ admin, key: { seller_account_id: SELLER } });
    await call(getOrders, "orders");
    expect(admin.queries.at(-1)?.calls[0]).toMatch(/^select:.*\bevent_version\b/);
  });
});
