import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Pager, parsePage } from "./pager";

/**
 * `?page=abc` used to reach Math.max(1, NaN) → .range(NaN, NaN) → a 500 for the
 * whole page, so any malformed shared link killed the view outright.
 */
describe("parsePage", () => {
  it("reads a valid page number", () => {
    expect(parsePage("3")).toBe(3);
  });

  it("falls back to page one for anything that is not a page number", () => {
    for (const bad of ["abc", "", undefined, "-1", "0", "1.5", "NaN", "Infinity", "1e3000"]) {
      expect(parsePage(bad)).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(parsePage(bad))).toBe(true);
    }
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("-1")).toBe(1);
  });

  it("caps an absurd page rather than scanning for it", () => {
    expect(parsePage("99999999")).toBe(10_000);
  });
});

describe("Pager", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pager page={1} hasNext={false} basePath="/dashboard/products" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers next but not previous on page one", () => {
    render(<Pager page={1} hasNext basePath="/dashboard/products" />);
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/dashboard/products?page=2",
    );
    expect(screen.queryByRole("link", { name: /previous/i })).toBeNull();
  });

  // Page 2 → 1 must drop the parameter rather than emitting ?page=1.
  it("links back to the bare path from page two", () => {
    render(<Pager page={2} hasNext={false} basePath="/dashboard/products" />);
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/dashboard/products",
    );
  });

  it("keeps other query parameters when paging", () => {
    render(
      <Pager
        page={2}
        hasNext
        basePath="/admin/products"
        params={{ q: "kente", status: "active", empty: undefined }}
      />,
    );
    const next = screen.getByRole("link", { name: /next/i }).getAttribute("href") ?? "";
    expect(next).toContain("q=kente");
    expect(next).toContain("status=active");
    expect(next).toContain("page=3");
    expect(next).not.toContain("empty");
  });

  it("shows which page you are on", () => {
    render(<Pager page={4} hasNext basePath="/dashboard/products" />);
    expect(screen.getByText("Page 4")).toBeInTheDocument();
  });
});
