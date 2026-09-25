import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  getLandingData: vi.fn(),
  country: "GH",
  actor: { kind: "anonymous" } as { kind: string },
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: async () => mocks.actor }));

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
  mocks.actor = { kind: "anonymous" };
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

  it("lets an operator preview the trust-led page before it is switched on", async () => {
    mocks.actor = { kind: "operator" };
    mocks.isFeatureEnabled.mockResolvedValue(false);
    mocks.getLandingData.mockResolvedValue({ features: { protect: false } });
    const page = await HomePage({ searchParams: Promise.resolve({ preview: "trust" }) });
    const children = (page as { props: { children: unknown[] } }).props.children;
    expect(JSON.stringify(children[0])).toMatch(/Preview — not public/);
  });

  it("ignores the preview parameter for everyone else", async () => {
    mocks.actor = { kind: "seller" };
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(kind(await HomePage({ searchParams: Promise.resolve({ preview: "trust" }) }))).toBe("classic");
  });
});
