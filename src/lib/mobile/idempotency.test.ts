// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * An in-memory `idempotency_keys` with the one constraint that matters —
 * unique (scope, key) — and just enough of the PostgREST builder for the
 * helper's calls. The point is to exercise the claim / replay / release state
 * machine, which is where duplicates would come from.
 */
type Row = { id: string; scope: string; key: string; response: unknown; expires_at: string };

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  failInsert: null as null | { code: string; message: string },
  failUpdate: false,
  nextId: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => makeBuilder(),
  }),
}));

function makeBuilder() {
  const filters: [string, unknown][] = [];
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: Partial<Row> = {};
  const matches = (row: Row) =>
    filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value);

  const run = () => {
    if (op === "insert") {
      if (db.failInsert) return { data: null, error: db.failInsert };
      const row = payload as Row;
      if (db.rows.some((r) => r.scope === row.scope && r.key === row.key)) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      const inserted = { ...row, id: `row-${++db.nextId}` };
      db.rows.push(inserted);
      return { data: { id: inserted.id }, error: null };
    }
    if (op === "update") {
      if (db.failUpdate) return { data: null, error: { code: "XX000", message: "boom" } };
      db.rows.filter(matches).forEach((r) => Object.assign(r, payload));
      return { data: null, error: null };
    }
    if (op === "delete") {
      db.rows = db.rows.filter((r) => !matches(r));
      return { data: null, error: null };
    }
    return { data: db.rows.find(matches) ?? null, error: null };
  };

  const builder = {
    insert(value: Partial<Row>) {
      op = "insert";
      payload = value;
      return builder;
    },
    update(value: Partial<Row>) {
      op = "update";
      payload = value;
      return builder;
    },
    delete() {
      op = "delete";
      return builder;
    },
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return builder;
    },
    single: async () => run(),
    maybeSingle: async () => run(),
    then(resolve: (value: ReturnType<typeof run>) => unknown) {
      return Promise.resolve(run()).then(resolve);
    },
  };
  return builder;
}

import { PENDING_STALE_MS, withIdempotency } from "./idempotency";

const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SCOPE = { route: "orders.transition", sellerAccountId: "seller-1" };

function request(body: unknown, key: string | null = KEY, path = "/api/mobile/v1/orders/o1/transition") {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== null) headers.set("idempotency-key", key);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  db.rows = [];
  db.failInsert = null;
  db.failUpdate = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("withIdempotency", () => {
  it("runs the handler once and replays its response to a repeat", async () => {
    const handler = vi.fn(async () => json(200, { order: { version: 2 } }));

    const first = await withIdempotency(request({ status: "confirmed" }), SCOPE, handler);
    const second = await withIdempotency(request({ status: "confirmed" }), SCOPE, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ order: { version: 2 } });
    expect(second.headers.get("idempotency-replayed")).toBe("true");
  });

  it("leaves requests without a key exactly as they were", async () => {
    const handler = vi.fn(async () => json(200, { ok: true }));

    await withIdempotency(request({}, null), SCOPE, handler);
    await withIdempotency(request({}, null), SCOPE, handler);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(db.rows).toHaveLength(0);
  });

  it("lets the handler read the body itself", async () => {
    const handler = vi.fn(async (req: Request) => json(200, await req.json()));
    const req = request({ status: "confirmed" });

    const response = await withIdempotency(req, SCOPE, () => handler(req));

    expect(await response.json()).toEqual({ status: "confirmed" });
  });

  it("replays a version conflict rather than re-running into a different answer", async () => {
    const handler = vi.fn(async () => json(409, { error: { code: "version_conflict" } }));

    await withIdempotency(request({}), SCOPE, handler);
    const again = await withIdempotency(request({}), SCOPE, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(again.status).toBe(409);
  });

  it.each([401, 403, 429, 500, 503])("does not keep a %i, so a retry runs afresh", async (status) => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(json(status, { error: {} }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await withIdempotency(request({}), SCOPE, handler);
    const retry = await withIdempotency(request({}), SCOPE, handler);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(retry.status).toBe(200);
  });

  it("releases the key when the handler throws", async () => {
    await expect(
      withIdempotency(request({}), SCOPE, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(db.rows).toHaveLength(0);
  });

  it("rejects the same key with a different body", async () => {
    await withIdempotency(request({ status: "confirmed" }), SCOPE, async () => json(200, {}));

    const reused = await withIdempotency(request({ status: "cancelled" }), SCOPE, async () =>
      json(200, {}),
    );

    expect(reused.status).toBe(422);
    expect((await reused.json()).error.code).toBe("validation_failed");
  });

  it("rejects the same key on a different order (path is part of the request)", async () => {
    await withIdempotency(request({}), SCOPE, async () => json(200, {}));
    const other = await withIdempotency(
      request({}, KEY, "/api/mobile/v1/orders/o2/transition"),
      SCOPE,
      async () => json(200, {}),
    );
    expect(other.status).toBe(422);
  });

  it("never replays one seller's response to another", async () => {
    const handler = vi.fn(async () => json(200, { seller: "one" }));
    await withIdempotency(request({}), SCOPE, handler);

    await withIdempotency(request({}), { ...SCOPE, sellerAccountId: "seller-2" }, handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("answers in_progress while the first request is still running", async () => {
    let finish: (r: Response) => void = () => undefined;
    const slow = withIdempotency(
      request({}),
      SCOPE,
      () => new Promise<Response>((resolve) => (finish = resolve)),
    );
    await vi.waitFor(() => expect(db.rows).toHaveLength(1));

    const concurrent = await withIdempotency(request({}), SCOPE, async () => json(200, {}));

    expect(concurrent.status).toBe(409);
    expect((await concurrent.json()).error.code).toBe("in_progress");
    finish(json(200, { ok: true }));
    await slow;
  });

  it("takes over a claim whose request died", async () => {
    db.rows.push({
      id: "dead",
      scope: "mobile:orders.transition:seller-1",
      key: KEY,
      response: {
        state: "pending",
        fingerprint: "whatever",
        startedAt: new Date(Date.now() - PENDING_STALE_MS - 1000).toISOString(),
      },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const handler = vi.fn(async () => json(200, { ok: true }));

    const response = await withIdempotency(request({}), SCOPE, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("treats an expired key as unused", async () => {
    db.rows.push({
      id: "old",
      scope: "mobile:orders.transition:seller-1",
      key: KEY,
      response: { state: "complete", fingerprint: "x", status: 200, body: { stale: true } },
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const handler = vi.fn(async () => json(200, { fresh: true }));

    const response = await withIdempotency(request({}), SCOPE, handler);

    expect(await response.json()).toEqual({ fresh: true });
  });

  it("fails closed when the key store is unavailable", async () => {
    db.failInsert = { code: "08006", message: "connection failure" };
    const handler = vi.fn(async () => json(200, {}));

    const response = await withIdempotency(request({}), SCOPE, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
  });

  it("still returns the handler's success if storing the receipt fails", async () => {
    db.failUpdate = true;

    const response = await withIdempotency(request({}), SCOPE, async () => json(201, { made: true }));

    expect(response.status).toBe(201);
  });

  it("rejects a malformed key", async () => {
    const handler = vi.fn(async () => json(200, {}));

    const response = await withIdempotency(request({}, "short"), SCOPE, handler);

    expect(response.status).toBe(422);
    expect(handler).not.toHaveBeenCalled();
  });

  it("replays a 204 without a body", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    await withIdempotency(request({}), SCOPE, handler);
    const again = await withIdempotency(request({}), SCOPE, handler);
    expect(again.status).toBe(204);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
