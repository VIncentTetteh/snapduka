import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));
const formStatus = vi.hoisted(() => ({ pending: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => ({ pending: formStatus.pending, data: null, method: null, action: null }),
}));

import { NavigationProgress } from "./navigation-progress";
import { PageLoading } from "./page-loading";
import { Spinner } from "./spinner";
import { SubmitButton } from "./submit-button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Spinner", () => {
  it("announces its label to screen readers", () => {
    render(<Spinner label="Saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
  });

  it("is decorative when a visible label says the same thing", () => {
    render(<Spinner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SubmitButton", () => {
  beforeEach(() => {
    formStatus.pending = false;
  });

  it("shows a spinner and the pending label while the action runs, and disables itself", () => {
    formStatus.pending = true;
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: /saving/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("is a plain button when idle", () => {
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeEnabled();
    expect(button.querySelector("svg")).toBeNull();
  });
});

describe("PageLoading", () => {
  it.each(["list", "detail", "shop", "centered"] as const)("says what is loading (%s)", (variant) => {
    render(<PageLoading variant={variant} label="Loading your dashboard" />);
    expect(screen.getByText(/loading your dashboard/i)).toBeInTheDocument();
  });
});

describe("NavigationProgress", () => {
  beforeEach(() => {
    nav.pathname = "/dashboard";
    nav.search = "";
    window.history.replaceState(null, "", "/dashboard");
  });

  function link(href: string, extra: Record<string, string> = {}) {
    const a = document.createElement("a");
    a.href = href;
    for (const [key, value] of Object.entries(extra)) a.setAttribute(key, value);
    a.textContent = "go";
    a.addEventListener("click", (event) => event.preventDefault(), { once: false });
    document.body.appendChild(a);
    return a;
  }

  it("shows the bar as soon as an internal link is followed, and finishes on the new page", () => {
    vi.useFakeTimers();
    const { rerender } = render(<NavigationProgress />);
    expect(screen.queryByText("Loading page")).not.toBeInTheDocument();

    // Capture-phase listener runs before the link's own handler.
    fireEvent.click(link("/dashboard/orders"));
    expect(screen.getByText("Loading page")).toBeInTheDocument();

    nav.pathname = "/dashboard/orders";
    rerender(<NavigationProgress />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("Loading page")).not.toBeInTheDocument();
  });

  it.each([
    ["an external link", "https://example.com/elsewhere", {}],
    ["a new-tab link", "/dashboard/orders", { target: "_blank" }],
    ["an in-page anchor", "#pricing", {}],
    ["the page already open", "/dashboard", {}],
  ])("stays hidden for %s", (_label, href, extra) => {
    render(<NavigationProgress />);
    fireEvent.click(link(href, extra as Record<string, string>));
    expect(screen.queryByText("Loading page")).not.toBeInTheDocument();
  });
});
