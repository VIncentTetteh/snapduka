import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("@/app/(auth)/login/actions", () => ({ signOut }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

import { AdminSidebar } from "./admin-sidebar";

describe("AdminSidebar", () => {
  afterEach(() => {
    cleanup();
    signOut.mockClear();
  });

  it("gives operators a way out of the console", async () => {
    const user = userEvent.setup();
    render(<AdminSidebar operatorName="ops@snapduka.com" badges={{ payouts: 0, cases: 0 }} />);

    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button.closest("form")).not.toBeNull();

    await user.click(button);

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("shows which operator is signed in", () => {
    render(<AdminSidebar operatorName="ops@snapduka.com" badges={{ payouts: 0, cases: 0 }} />);

    expect(screen.getByText("ops@snapduka.com")).toBeInTheDocument();
  });
});
