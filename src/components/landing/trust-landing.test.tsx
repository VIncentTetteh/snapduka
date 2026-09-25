import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LandingData } from "@/lib/landing/data";

const testimonials = vi.hoisted(() => ({ list: [] as { text: string; name: string; shop: string; city: string }[] }));
vi.mock("./testimonials", () => ({
  get TESTIMONIALS() {
    return testimonials.list;
  },
}));

import { TrustLanding } from "./trust-landing";

function data(overrides: Partial<LandingData["features"]> = {}): LandingData {
  return {
    country: "GH",
    currency: "GHS",
    plans: [
      { code: "free", name: "Free", monthlyMinor: 0 },
      { code: "growth", name: "Growth", monthlyMinor: 6000 },
      { code: "scale", name: "Scale", monthlyMinor: null },
    ],
    fees: {
      platformBps: 700,
      protectBps: 150,
      protectMinMinor: 100,
      protectCapMinor: 2000,
      instantPayoutBps: 100,
      instantPayoutMinMinor: 100,
      inspectionHours: 24,
      autoReleaseHours: 168,
    },
    features: { protect: true, whatsappAssistant: false, snapToList: false, instantPayout: false, ...overrides },
  };
}

afterEach(() => {
  cleanup();
  testimonials.list = [];
});

describe("TrustLanding", () => {
  it("leads with getting paid up front", () => {
    render(<TrustLanding data={data()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: /get paid before you ship — without scaring buyers away/i }),
    ).toBeInTheDocument();
  });

  it("tells the story as an ordered buyer–seller exchange a screen reader hears in order", () => {
    render(<TrustLanding data={data()} />);
    const chat = screen.getByRole("list", { name: /buyer and a seller agree a sale/i });
    const items = within(chat).getAllByRole("listitem");
    expect(items[1]).toHaveTextContent(/won't block me/i);
    expect(items.at(-1)).toHaveTextContent(/delivered · seller paid/i);
  });

  it("states the real fees for the market", () => {
    render(<TrustLanding data={data()} />);
    expect(screen.getAllByText(/7% when you sell online|7% on sales paid online/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Protect fee of 1\.5%/)).toHaveTextContent(/GH₵\s?1\.00.*GH₵\s?20\.00/);
    expect(screen.getByText(/after a 24-hour window/i)).toHaveTextContent(/7 days/);
  });

  it("prices plans from the database, and says when a plan is not sold in the market", () => {
    render(<TrustLanding data={data()} />);
    expect(screen.getByText("No monthly fee")).toBeInTheDocument();
    expect(screen.getByText(/GH₵\s?60\.00 \/ month/)).toBeInTheDocument();
    expect(screen.getByText("Not yet in Ghana")).toBeInTheDocument();
  });

  it("lists only the features switched on for the market", () => {
    const { rerender } = render(<TrustLanding data={data()} />);
    expect(screen.queryByText("Sell inside WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByText("Snap a photo, it’s listed")).not.toBeInTheDocument();
    expect(screen.getByText("One link for every channel")).toBeInTheDocument();

    rerender(<TrustLanding data={data({ whatsappAssistant: true, snapToList: true, instantPayout: true })} />);
    expect(screen.getByText("Sell inside WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Snap a photo, it’s listed")).toBeInTheDocument();
    expect(screen.getByText("Withdraw to mobile money in minutes")).toBeInTheDocument();
  });

  it("shows no testimonials section until there are real quotes", () => {
    const { rerender } = render(<TrustLanding data={data()} />);
    expect(screen.queryByRole("heading", { name: /from sellers using protect/i })).not.toBeInTheDocument();

    testimonials.list = [{ text: "Buyers stopped asking for pay on delivery.", name: "Ama", shop: "Ama's Boutique", city: "Accra" }];
    rerender(<TrustLanding data={data()} />);
    expect(screen.getByRole("heading", { name: /from sellers using protect/i })).toBeInTheDocument();
  });

  it("sends every seller CTA to onboarding and buyers to the Protect explainer", () => {
    render(<TrustLanding data={data()} />);
    for (const link of screen.getAllByRole("link", { name: /start selling free/i })) {
      expect(link).toHaveAttribute("href", "/onboarding");
    }
    expect(screen.getByRole("link", { name: /how buyers are protected/i })).toHaveAttribute("href", "/protect");
  });
});
