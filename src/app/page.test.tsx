import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  getLandingData: vi.fn(),
  country: "GH",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-vercel-ip-country": mocks.country }),
}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/landing/data", () => ({
  visitorCountry: (h: Headers) => h.get("x-vercel-ip-country") ?? "GH",
  getLandingData: mocks.getLandingData,
}));
vi.mock("@/components/landing/classic-landing", () => ({ ClassicLanding: () => "classic" }));
vi.mock("@/components/landing/trust-landing", () => ({ TrustLanding: () => "trust" }));

import HomePage, { generateMetadata } from "./page";

/** Which landing a rendered page element is (the two are mocked as named stubs). */
function kind(element: unknown): string {
  const type = (element as { type: () => string }).type;
  return type();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.country = "GH";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("HomePage", () => {
  it("shows the classic page while new_homepage is off for the market", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(kind(await HomePage())).toBe("classic");
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("new_homepage", { country: "GH" });
  });

  it("shows the trust-led page only when the flag is on and Protect is live", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.getLandingData.mockResolvedValue({ features: { protect: true } });
    expect(kind(await HomePage())).toBe("trust");
    expect((await generateMetadata()).title).toMatch(/get paid before you ship/i);
  });

  it("never promises Protect on the flag alone", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.getLandingData.mockResolvedValue({ features: { protect: false } });
    expect(kind(await HomePage())).toBe("classic");
  });

  it("falls back to the classic page if the lookup fails", async () => {
    mocks.isFeatureEnabled.mockRejectedValue(new Error("db down"));
    expect(kind(await HomePage())).toBe("classic");
  });

  it("decides per visitor market", async () => {
    mocks.country = "NG";
    mocks.isFeatureEnabled.mockResolvedValue(false);
    await HomePage();
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("new_homepage", { country: "NG" });
  });
});
