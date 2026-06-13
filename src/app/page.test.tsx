import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("introduces SnapDuka and links sellers to login", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /turn social attention into completed orders/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /start selling/i }),
    ).toHaveAttribute("href", "/login");
  });
});
