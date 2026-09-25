// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const isFeatureEnabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flags", () => ({ isFeatureEnabled }));

import { manualAdapter } from "./adapters/manual";
import { createSandboxAdapter } from "./adapters/sandbox";
import { createYangoAdapter } from "./adapters/yango";
import {
  getCourierAdapter,
  resolveBookingAdapter,
  resolveQuotingAdapters,
  setCourierRegistryForTests,
} from "./registry";

const scope = { sellerAccountId: "seller-1", country: "GH" as const };

beforeEach(() => {
  isFeatureEnabled.mockReset();
  setCourierRegistryForTests([
    manualAdapter,
    createSandboxAdapter({ enabled: true }),
    createYangoAdapter({}),
  ]);
});
afterEach(() => setCourierRegistryForTests(null));

describe("courier registry", () => {
  it("falls back to the manual adapter for a courier with no integration", () => {
    expect(getCourierAdapter("bolt")).toBe(manualAdapter);
  });

  it("books through an adapter only when its flag is on", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    expect(await resolveBookingAdapter("sandbox", scope)).toBeNull();

    isFeatureEnabled.mockResolvedValue(true);
    expect((await resolveBookingAdapter("sandbox", scope))?.id).toBe("sandbox");
    expect(isFeatureEnabled).toHaveBeenCalledWith("courier_booking:sandbox", scope);
  });

  it("never books through an adapter that is not configured, whatever the flag says", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    expect(await resolveBookingAdapter("yango", scope)).toBeNull();
  });

  it("never books a courier without an integration through an adapter", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    expect(await resolveBookingAdapter("bolt", scope)).toBeNull();
    expect(await resolveBookingAdapter("manual", scope)).toBeNull();
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("quotes only through ready, flagged adapters", async () => {
    isFeatureEnabled.mockImplementation(async (key: string) => key === "courier_booking:sandbox");
    const adapters = await resolveQuotingAdapters(scope);
    expect(adapters.map((a) => a.id)).toEqual(["sandbox"]);
  });
});
