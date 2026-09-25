import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLandingData: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/landing/data", () => ({ visitorCountry: () => "GH", getLandingData: mocks.getLandingData }));

import ProtectPage, { generateMetadata } from "./page";

function landing(protect: boolean) {
  return {
    country: "GH",
    currency: "GHS",
    plans: [],
    fees: { platformBps: 700, protectBps: 150, protectMinMinor: 100, protectCapMinor: 2000, instantPayoutBps: 100, instantPayoutMinMinor: 100, inspectionHours: 24, autoReleaseHours: 168 },
    features: { protect, whatsappAssistant: false, snapToList: false, instantPayout: false },
  };
}

beforeEach(() => mocks.getLandingData.mockResolvedValue(landing(true)));
afterEach(cleanup);

describe("/protect", () => {
  it("explains the delivery code and the market's real windows and fee", async () => {
    render(await ProtectPage());
    expect(screen.getByRole("heading", { level: 1, name: /your payment is held until your order arrives/i })).toBeInTheDocument();
    expect(screen.getByText(/you have 24 hours to report a problem/i)).toBeInTheDocument();
    expect(screen.getByText(/within 7 days of dispatch/i)).toBeInTheDocument();
    expect(screen.getByText(/Protect fee of 1\.5%/)).toHaveTextContent(/GH₵\s?1\.00.*GH₵\s?20\.00/);
    expect(screen.getByText(/nobody from snapduka will ever ask you for it/i)).toBeInTheDocument();
  });

  it("is not indexed where Protect is not live", async () => {
    mocks.getLandingData.mockResolvedValue(landing(false));
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });

  it("is indexable once Protect is live", async () => {
    expect((await generateMetadata()).robots).toBeUndefined();
  });
});
