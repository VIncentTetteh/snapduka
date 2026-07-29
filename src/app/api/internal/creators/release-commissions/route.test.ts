import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInternalJobRequest: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: mocks.isInternalJobRequest }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/internal/creators/release-commissions", { method: "POST" });
}

describe("release-commissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInternalJobRequest.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
  });

  // This endpoint moves money from "held" to "owed", so an open door would let
  // anyone shorten every seller's hold window to zero.
  it("rejects a request without the internal job secret", async () => {
    mocks.isInternalJobRequest.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("releases matured commissions and reports the count", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ released: 3 });
    expect(mocks.rpc).toHaveBeenCalledWith("release_due_creator_commissions");
  });

  it("reports zero rather than failing when nothing is due", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });

    await expect((await POST(request())).json()).resolves.toEqual({ released: 0 });
  });

  it("returns 500 when the release fails, so the cron surfaces it", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const response = await POST(request());

    expect(response.status).toBe(500);
  });
});
