import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  captureCheckIn: vi.fn(),
  flush: vi.fn(),
  authorized: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  getClient: mocks.getClient,
  captureCheckIn: mocks.captureCheckIn,
  flush: mocks.flush,
}));
vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: mocks.authorized }));

import { withCronMonitor } from "./cron";

const request = () => new Request("https://snapduka.test/api/internal/x", { method: "POST" });

describe("withCronMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClient.mockReturnValue({});
    mocks.authorized.mockReturnValue(true);
    mocks.captureCheckIn.mockReturnValue("check-in-1");
    mocks.flush.mockResolvedValue(true);
  });

  it("checks in progress then ok, upserting the schedule, and flushes", async () => {
    const handler = vi.fn(async () => Response.json({ processed: 3 }));
    const wrapped = withCronMonitor("snapduka-job", handler, { schedule: "*/5 * * * *" });

    const response = await wrapped(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 3 });
    expect(mocks.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "snapduka-job", status: "in_progress" },
      {
        schedule: { type: "crontab", value: "*/5 * * * *" },
        timezone: "UTC",
        checkinMargin: 5,
        maxRuntime: 10,
      },
    );
    expect(mocks.captureCheckIn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ checkInId: "check-in-1", monitorSlug: "snapduka-job", status: "ok", duration: expect.any(Number) }),
    );
    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });

  it("reports a 5xx response as an error without changing the response", async () => {
    const wrapped = withCronMonitor("snapduka-job", async () => new Response("boom", { status: 503 }));
    const response = await wrapped(request());
    expect(response.status).toBe(503);
    expect(mocks.captureCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error" }));
  });

  it("treats 4xx as ok: the job ran and chose to refuse the input", async () => {
    const wrapped = withCronMonitor("snapduka-job", async () => new Response(null, { status: 409 }));
    await wrapped(request());
    expect(mocks.captureCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ok" }));
  });

  it("reports a thrown error and rethrows the same error", async () => {
    const failure = new Error("db down");
    const wrapped = withCronMonitor("snapduka-job", async () => {
      throw failure;
    });
    await expect(wrapped(request())).rejects.toBe(failure);
    expect(mocks.captureCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error" }));
    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });

  it("omits monitor config when no schedule is given", async () => {
    const wrapped = withCronMonitor("snapduka-job", async () => new Response(null));
    await wrapped(request());
    expect(mocks.captureCheckIn).toHaveBeenNthCalledWith(1, expect.anything(), undefined);
  });

  it("is a pass-through when Sentry is not initialised", async () => {
    mocks.getClient.mockReturnValue(undefined);
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withCronMonitor("snapduka-job", handler);
    const req = request();
    await wrapped(req);
    expect(handler).toHaveBeenCalledWith(req);
    expect(mocks.captureCheckIn).not.toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it("never checks in for unauthenticated callers but still runs the handler", async () => {
    mocks.authorized.mockReturnValue(false);
    const handler = vi.fn(async () => Response.json({ error: "Unauthorized." }, { status: 401 }));
    const response = await withCronMonitor("snapduka-job", handler)(request());
    expect(response.status).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.captureCheckIn).not.toHaveBeenCalled();
  });

  it("forwards extra route handler arguments", async () => {
    const handler = vi.fn(async (_request: Request, context: { params: Promise<{ id: string }> }) =>
      Response.json(await context.params),
    );
    const response = await withCronMonitor("snapduka-job", handler)(request(), { params: Promise.resolve({ id: "7" }) });
    expect(await response.json()).toEqual({ id: "7" });
  });
});
