import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareButton } from "./share-button";

// Regression: ISSUE-003 — the product page shared the product URL under a
// "Share store" label and announced the shop name, and ISSUE-004 — the
// WhatsApp fallback existed and was tested but nothing in production called
// it, so a blocked clipboard left the button doing nothing at all.
// Found by /qa on 2026-09-01
// Report: .gstack/qa-reports/qa-report-snapduka-2026-09-01.md

const PRODUCT_URL = "https://snapduka.com/sika-threads/products/abc";

describe("ShareButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "share");
  });

  it("says it shares a product, not the store, on a product page", () => {
    render(<ShareButton subject="product" title="Kente Weave Tote" url={PRODUCT_URL} />);
    expect(screen.getByRole("button", { name: "Share this product" })).toBeInTheDocument();
  });

  it("still says store when that is what is being shared", () => {
    render(<ShareButton subject="store" title="Sika Threads" url="https://snapduka.com/sika-threads" />);
    expect(screen.getByRole("button", { name: "Share store" })).toBeInTheDocument();
  });

  it("announces the product name to the share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share, writable: true });

    render(<ShareButton subject="product" title="Kente Weave Tote" url={PRODUCT_URL} />);
    await userEvent.click(screen.getByRole("button", { name: "Share this product" }));

    expect(share).toHaveBeenCalledWith({ title: "Kente Weave Tote", url: PRODUCT_URL });
  });

  it("falls back to WhatsApp when there is no share sheet and no clipboard", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
      writable: true,
    });

    render(<ShareButton subject="product" title="Kente Weave Tote" url={PRODUCT_URL} />);
    await userEvent.click(screen.getByRole("button", { name: "Share this product" }));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0][0]).toContain("wa.me");
    expect(open.mock.calls[0][0]).toContain(encodeURIComponent(PRODUCT_URL));
  });

  it("prefers the clipboard over WhatsApp when it is available", async () => {
    const open = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("open", open);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
      writable: true,
    });

    render(<ShareButton subject="store" title="Sika Threads" url={PRODUCT_URL} />);
    await userEvent.click(screen.getByRole("button", { name: "Share store" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PRODUCT_URL));
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });
});
