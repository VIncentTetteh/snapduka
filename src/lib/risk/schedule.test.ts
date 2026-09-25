// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/risk/engine", () => ({ assessCheckoutRisk: vi.fn().mockResolvedValue([]) }));

import { scheduleRiskAssessment } from "./schedule";

beforeEach(() => vi.clearAllMocks());

describe("scheduleRiskAssessment", () => {
  it("defers the work to after the response", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    scheduleRiskAssessment("checkout_init", task);
    expect(task).not.toHaveBeenCalled();

    await mocks.after.mock.calls[0][0]();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("never lets a failing assessment escape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    scheduleRiskAssessment("payout_request", () => Promise.reject(new Error("db down")));
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
  });

  it("does not throw outside a request scope", () => {
    mocks.after.mockImplementation(() => {
      throw new Error("outside request scope");
    });
    expect(() => scheduleRiskAssessment("kyc_result", vi.fn())).not.toThrow();
  });
});
