import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentifierForm } from "./identifier-form";

function renderForm() {
  const action = vi.fn();
  render(<IdentifierForm action={action} next="/onboarding" />);
  return { action, user: userEvent.setup() };
}

/** The hidden fields the server action reads back. */
function hiddenValue(name: string): string | null {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? null;
}

describe("IdentifierForm", () => {
  afterEach(cleanup);

  it("starts on the Email tab with no country picker", () => {
    renderForm();

    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Phone" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Country")).not.toBeInTheDocument();
    expect(hiddenValue("mode")).toBe("email");
  });

  it("switches to the Phone tab, revealing the country picker", async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole("tab", { name: "Phone" }));

    expect(screen.getByRole("tab", { name: "Phone" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toHaveValue("GH");
    expect(hiddenValue("mode")).toBe("phone");
    expect(hiddenValue("region")).toBe("GH");
  });

  it("moves between tabs with arrow keys", async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole("tab", { name: "Email" }));
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Phone" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
  });

  it("clears a typed value when switching tabs so it cannot be submitted to the wrong mode", async () => {
    const { user } = renderForm();

    await user.type(screen.getByLabelText(/email address/i), "seller@example.com");
    await user.click(screen.getByRole("tab", { name: "Phone" }));

    expect(screen.getByLabelText(/phone number/i)).toHaveValue("");
  });

  it("blocks submit and shows a specific error for a malformed email", async () => {
    const { action, user } = renderForm();

    await user.type(screen.getByLabelText(/email address/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /send me a code/i }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address, like you@example.com.");
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("blocks submit and names the digit count for a short Ghana number", async () => {
    const { action, user } = renderForm();

    await user.click(screen.getByRole("tab", { name: "Phone" }));
    await user.type(screen.getByLabelText(/phone number/i), "24123");
    await user.click(screen.getByRole("button", { name: /send me a code/i }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ghana numbers have 9 digits after +233. Example: +233241234567",
    );
  });

  it("validates on blur once something has been typed", async () => {
    const { user } = renderForm();

    await user.type(screen.getByLabelText(/email address/i), "bad@");
    await user.tab();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("stays quiet on blur when the field is still untouched", async () => {
    const { user } = renderForm();

    await user.click(screen.getByLabelText(/email address/i));
    await user.tab();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the error as soon as the user edits the value", async () => {
    const { user } = renderForm();

    await user.type(screen.getByLabelText(/email address/i), "bad@");
    await user.click(screen.getByRole("button", { name: /send me a code/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/email address/i), "example.com");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-validates against the newly selected country", async () => {
    const { action, user } = renderForm();

    await user.click(screen.getByRole("tab", { name: "Phone" }));
    // 10 local digits: valid for Nigeria, wrong length for Ghana.
    await user.type(screen.getByLabelText(/phone number/i), "08012345678");
    await user.click(screen.getByRole("button", { name: /send me a code/i }));
    expect(action).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Country"), "NG");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(hiddenValue("region")).toBe("NG");
  });

  it("accepts any international number under Other", async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole("tab", { name: "Phone" }));
    await user.selectOptions(screen.getByLabelText("Country"), "OTHER");
    await user.type(screen.getByLabelText(/phone number/i), "+254712345678");
    await user.tab();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries the redirect target through as a hidden field", () => {
    renderForm();

    expect(hiddenValue("next")).toBe("/onboarding");
  });
});
