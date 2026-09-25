import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider } from "./cart-provider";
import { CheckoutForm } from "./checkout-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const PRODUCT = {
  id: "f1000000-0000-4000-8000-000000000002",
  name: "Kente scarf",
  currency: "GHS",
  price_minor: 10000,
  variantId: null,
  variantName: null,
  quantity: 1,
};
const METHOD = { id: "m1", name: "Rider", type: "delivery", fee_minor: 0, instructions: "" };

function renderForm(bnpl: { label: string } | null) {
  return render(
    <CartProvider shopSlug="bnpl-shop">
      <CheckoutForm
        shopId="shop-1"
        shopName="BNPL Shop"
        country="GH"
        products={[PRODUCT]}
        methods={[METHOD]}
        fromCart={false}
        onlinePaymentsAvailable
        bnpl={bnpl}
      />
    </CartProvider>,
  );
}

function fill(container: HTMLElement) {
  const set = (name: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]:not([type="hidden"])`);
    if (input) fireEvent.change(input, { target: { value } });
  };
  set("name", "Ama Mensah");
  set("email", "ama@example.com");
  set("phone", "0241234567");
  set("line1", "12 Oxford St");
  set("city", "Accra");
  const region = container.querySelector<HTMLSelectElement>('select[name="region"]');
  if (region && region.options.length > 1) fireEvent.change(region, { target: { value: region.options[1]!.value } });
  set("region", "Greater Accra");
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/checkout/orders") {
      return new Response(JSON.stringify({ orderId: "o1", trackingToken: "tok-1" }), { status: 201 });
    }
    return new Response(JSON.stringify({ error: "stop here" }), { status: 409 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("CheckoutForm with pay later", () => {
  it("offers it unticked: paying later is the buyer's choice, never a default", async () => {
    renderForm({ label: "Pay in 4" });
    expect(await screen.findByRole("checkbox", { name: /Pay in 4/ })).not.toBeChecked();
  });

  it("starts the BNPL checkout, not Paystack, when the buyer chooses it", async () => {
    const { container } = renderForm({ label: "Pay in 4" });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Pay in 4/ }));
    fill(container);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/payments/bnpl/initialize")).toBe(true),
    );
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/payments/paystack/initialize")).toBe(false);
  });

  it("pays with Paystack when the buyer leaves it unticked", async () => {
    const { container } = renderForm({ label: "Pay in 4" });
    await screen.findByRole("checkbox", { name: /Pay in 4/ });
    fill(container);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/payments/paystack/initialize")).toBe(true),
    );
  });

  it("shows nothing about pay later where it is not offered", async () => {
    renderForm(null);
    await screen.findByText(/Pay now with Paystack/);
    expect(screen.queryByText(/Pay in 4/)).not.toBeInTheDocument();
  });
});
