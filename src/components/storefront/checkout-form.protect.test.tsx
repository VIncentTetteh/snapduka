import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider } from "./cart-provider";
import { CheckoutForm } from "./checkout-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const PROTECT = { feeBps: 150, minMinor: 100, capMinor: 2000 };
const PRODUCT = {
  id: "f1000000-0000-4000-8000-000000000001",
  name: "Kente scarf",
  currency: "GHS",
  price_minor: 10000,
  variantId: null,
  variantName: null,
  quantity: 1,
};
const METHOD = { id: "m1", name: "Rider", type: "delivery", fee_minor: 0, instructions: "" };

function renderForm(protect: typeof PROTECT | null) {
  return render(
    <CartProvider shopSlug="protect-shop">
      <CheckoutForm
        shopId="shop-1"
        shopName="Protect Shop"
        country="GH"
        products={[PRODUCT]}
        methods={[METHOD]}
        fromCart={false}
        onlinePaymentsAvailable
        protect={protect}
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
    if (url.endsWith("/protect")) return new Response(JSON.stringify({ totalMinor: 10150 }), { status: 200 });
    if (url === "/api/payments/paystack/initialize") {
      return new Response(JSON.stringify({ error: "stop here" }), { status: 409 });
    }
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("CheckoutForm with SnapDuka Protect", () => {
  it("offers Protect ticked by default and prices it into the total", async () => {
    renderForm(PROTECT);
    expect(await screen.findByText(/Protect my payment/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Protect my payment/ })).toBeChecked();
    expect(screen.getByText("SnapDuka Protect")).toBeInTheDocument();
  });

  it("adds Protect to the order before starting payment", async () => {
    const { container } = renderForm(PROTECT);
    fill(container);
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/payments/paystack/initialize")).toBe(true),
    );
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.indexOf("/api/orders/tok-1/protect")).toBeGreaterThan(urls.indexOf("/api/checkout/orders"));
    expect(urls.indexOf("/api/payments/paystack/initialize")).toBeGreaterThan(urls.indexOf("/api/orders/tok-1/protect"));
    const protectCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/protect"))!;
    expect(JSON.parse(String((protectCall[1] as RequestInit).body))).toEqual({ enabled: true });
  });

  it("states the opt-out explicitly when the buyer unticks Protect", async () => {
    const { container } = renderForm(PROTECT);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Protect my payment/ }));
    fill(container);
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/protect"))).toBe(true));
    const protectCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/protect"))!;
    expect(JSON.parse(String((protectCall[1] as RequestInit).body))).toEqual({ enabled: false });
  });

  it("shows nothing about Protect where it is not offered", async () => {
    renderForm(null);
    await screen.findByText(/Pay now with Paystack/);
    expect(screen.queryByText(/Protect my payment/)).not.toBeInTheDocument();
  });
});
