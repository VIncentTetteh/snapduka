import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signOut, pathname } = vi.hoisted(() => ({
  signOut: vi.fn(),
  pathname: { current: "/dashboard" },
}));

vi.mock("@/app/(auth)/login/actions", () => ({ signOut }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import { AccountMenu } from "./account-menu";

function renderMenu() {
  render(<AccountMenu ownerName="Ama Sika" shopName="Sika Threads" />);
  return userEvent.setup();
}

describe("AccountMenu", () => {
  afterEach(() => {
    cleanup();
    pathname.current = "/dashboard";
    signOut.mockClear();
  });

  it("starts closed, with the trigger marked collapsed", () => {
    render(<AccountMenu ownerName="Ama Sika" shopName="Sika Threads" />);

    expect(screen.getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on click and exposes Sign out", async () => {
    const user = renderMenu();

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
  });

  it("shows who is signed in, so a shared device is obvious before signing out", async () => {
    const user = renderMenu();

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.getByText("Ama Sika")).toBeInTheDocument();
    expect(screen.getByText("Sika Threads")).toBeInTheDocument();
  });

  it("submits the sign-out action", async () => {
    const user = renderMenu();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("puts Sign out in a form, not a link, so no GET can end the session", async () => {
    const user = renderMenu();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const signOutItem = screen.getByRole("menuitem", { name: "Sign out" });

    expect(signOutItem.tagName).toBe("BUTTON");
    expect(signOutItem.closest("form")).not.toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = renderMenu();
    const trigger = screen.getByRole("button", { name: "Account menu" });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when clicking outside", async () => {
    const user = renderMenu();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("stays open when clicking inside the menu", async () => {
    const user = renderMenu();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByText("Sika Threads"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("toggles shut on a second trigger click", async () => {
    const user = renderMenu();
    const trigger = screen.getByRole("button", { name: "Account menu" });

    await user.click(trigger);
    await user.click(trigger);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
