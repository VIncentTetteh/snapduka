import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInternalJobRequest: vi.fn(),
  rpc: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: mocks.isInternalJobRequest }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, storage: { from: mocks.from } }),
}));

import { POST } from "./route";

const SELLER = "09710000-0000-4000-8000-000000000001";
const draft = (n: number) => `${SELLER}/drafts/${String(n).padStart(4, "0")}.jpg`;

function request() {
  return new Request("http://localhost/api/internal/storage/prune-drafts", { method: "POST" });
}

/** Serves candidates from `names` after the cursor, like the SQL function. */
function candidates(names: string[]) {
  mocks.rpc.mockImplementation(async (_fn: string, args: { p_after?: string; p_limit: number }) => ({
    data: names
      .filter((name) => !args.p_after || name > args.p_after)
      .slice(0, args.p_limit)
      .map((name) => ({ name })),
    error: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isInternalJobRequest.mockReturnValue(true);
  mocks.from.mockReturnValue({ remove: mocks.remove });
  mocks.remove.mockImplementation(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/internal/storage/prune-drafts", () => {
  it("rejects unauthenticated callers", async () => {
    mocks.isInternalJobRequest.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("asks for drafts older than 48 hours and deletes them from product-images", async () => {
    candidates([draft(1), draft(2)]);
    const body = await (await POST(request())).json();
    expect(body).toEqual({ deleted: 2, failed: 0, batches: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("draft_media_prune_candidates", {
      p_min_age: "48 hours",
      p_after: undefined,
      p_limit: 100,
    });
    expect(mocks.from).toHaveBeenCalledWith("product-images");
    expect(mocks.remove).toHaveBeenCalledWith([draft(1), draft(2)]);
  });

  it("pages by name in bounded batches", async () => {
    candidates(Array.from({ length: 250 }, (_, i) => draft(i)));
    const body = await (await POST(request())).json();
    expect(body).toEqual({ deleted: 250, failed: 0, batches: 3 });
    expect(mocks.rpc.mock.calls[1][1].p_after).toBe(draft(99));
    expect(mocks.rpc.mock.calls[2][1].p_after).toBe(draft(199));
  });

  it("stops after the batch cap, leaving the rest for tomorrow", async () => {
    candidates(Array.from({ length: 5_000 }, (_, i) => draft(i)));
    const body = await (await POST(request())).json();
    expect(body.batches).toBe(10);
    expect(body.deleted).toBe(1_000);
  });

  /** Defence in depth: whatever the SQL returns, only drafts/{file} is removed. */
  it("never removes a path that is not a top-level draft", async () => {
    candidates([
      draft(1),
      `${SELLER}/09730000-0000-4000-8000-000000000001/photo.jpg`,
      `${SELLER}/drafts/nested/x.jpg`,
      `${SELLER}/drafts/../x.jpg`,
      "not-a-seller/drafts/x.jpg",
    ]);
    await POST(request());
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith([draft(1)]);
  });

  it("steps over a batch the Storage API refuses, and reports it", async () => {
    candidates(Array.from({ length: 150 }, (_, i) => draft(i)));
    mocks.remove
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockImplementation(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null }));
    const body = await (await POST(request())).json();
    expect(body).toEqual({ deleted: 50, failed: 100, batches: 2 });
  });

  it("500s when candidates cannot be selected", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "down" } });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
