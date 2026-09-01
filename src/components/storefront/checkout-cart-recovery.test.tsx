import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider } from "./cart-provider";
import { CheckoutCartRecovery } from "./checkout-cart-recovery";

// Regression: ISSUE-001 — landing on /checkout without the cart in the URL
// rendered "Your cart is empty" while the header badge still counted the
// saved cart, stranding the shopper in the middle of the buying flow.
// Found by /qa on 2026-09-01
// Report: .gstack/qa-reports/qa-report-snapduka-2026-09-01.md

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const SAVED_CART = JSON.stringify([
  { productId: "f1000000-0000-4000-8000-000000000001", variantId: null, quantity: 2 },
]);

function renderRecovery(urlCarriedCart: boolean) {
  return render(
    <CartProvider shopSlug="sika-threads">
      <CheckoutCartRecovery urlCarriedCart={urlCarriedCart}>
        <p>Your cart is empty</p>
      </CheckoutCartRecovery>
    </CartProvider>,
  );
}

describe("CheckoutCartRecovery", () => {
  beforeEach(() => {
    replace.mockClear();
    localStorage.clear();
  });

  it("restores a saved cart into the URL instead of claiming the cart is empty", async () => {
    localStorage.setItem("snapduka:cart:sika-threads", SAVED_CART);
    renderRecovery(false);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0][0]).toContain("f1000000-0000-4000-8000-000000000001");
    expect(screen.queryByText("Your cart is empty")).not.toBeInTheDocument();
  });

  it("shows the empty state when there is genuinely nothing saved", async () => {
    renderRecovery(false);

    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("never redirects once the URL already carries a cart, so it cannot loop", async () => {
    // A stale or corrupted saved cart the server rejects would otherwise bounce
    // back and forth between the page and this component forever.
    localStorage.setItem("snapduka:cart:sika-threads", SAVED_CART);
    renderRecovery(true);

    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
