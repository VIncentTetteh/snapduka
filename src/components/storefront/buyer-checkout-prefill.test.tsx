import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuyerCheckoutPrefill, SAVE_ADDRESS_FIELD, saveBuyerAddressIfRequested } from "./buyer-checkout-prefill";

const SIGNED_IN = {
  signedIn: true,
  name: "Ama Mensah",
  phone: "+233241234567",
  defaultAddressId: "a2",
  addresses: [
    { id: "a1", label: null, line1: "Old place", area: "", city: "Tema", region: "", country: "GH", digitalAddress: null, landmark: null },
    { id: "a2", label: "Home", line1: "12 Oxford St", area: "Osu", city: "Accra", region: "Greater Accra", country: "GH", digitalAddress: "GA-123-4567", landmark: "Blue gate" },
  ],
};

function mockFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderInForm(country: "GH" | "NG" = "GH", typed: Record<string, string> = {}) {
  return render(
    <form data-testid="form">
      <BuyerCheckoutPrefill country={country} />
      {["name", "phone", "line1", "area", "city", "region", "digitalAddress", "landmark"].map((name) => (
        <input key={name} name={name} aria-label={name} defaultValue={typed[name] ?? ""} />
      ))}
    </form>,
  );
}

function value(name: string): string {
  return (screen.getByLabelText(name) as HTMLInputElement).value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BuyerCheckoutPrefill", () => {
  it("leaves a guest's form untouched and renders nothing while the feature is off", async () => {
    const fetchMock = mockFetch({ signedIn: false });
    const { container } = renderInForm();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(value("name")).toBe("");
    expect(container.querySelector(`input[name="${SAVE_ADDRESS_FIELD}"]`)).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  it("offers sign-in to a guest once the feature is live", async () => {
    mockFetch({ signedIn: false, available: true });
    renderInForm();

    expect(await screen.findByRole("link", { name: /sign in with your phone/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/me?next="),
    );
  });

  it("fills the buyer's details and default address", async () => {
    mockFetch(SIGNED_IN);
    renderInForm();

    await waitFor(() => expect(value("name")).toBe("Ama Mensah"));
    expect(value("phone")).toBe("+233241234567");
    expect(value("line1")).toBe("12 Oxford St");
    expect(value("city")).toBe("Accra");
    expect(value("digitalAddress")).toBe("GA-123-4567");
    expect(value("landmark")).toBe("Blue gate");
    expect(screen.getByRole("checkbox", { name: /save this delivery address/i })).not.toBeChecked();
  });

  it("never overwrites what the buyer already typed", async () => {
    mockFetch(SIGNED_IN);
    renderInForm("GH", { name: "Someone Else", line1: "Typed street" });

    await waitFor(() => expect(value("phone")).toBe("+233241234567"));
    expect(value("name")).toBe("Someone Else");
    expect(value("line1")).toBe("Typed street");
  });

  it("does not fill a phone or address from another country", async () => {
    mockFetch(SIGNED_IN);
    renderInForm("NG");

    await waitFor(() => expect(value("name")).toBe("Ama Mensah"));
    expect(value("phone")).toBe("");
    expect(value("line1")).toBe("");
  });

  it("stays out of the way when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderInForm();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(value("name")).toBe("");
  });
});

describe("saveBuyerAddressIfRequested", () => {
  function formData(values: Record<string, string>) {
    const data = new FormData();
    Object.entries(values).forEach(([k, v]) => data.set(k, v));
    return data;
  }

  it("does nothing unless the buyer ticked the box", () => {
    const fetchMock = mockFetch({});

    saveBuyerAddressIfRequested(formData({ line1: "12 Oxford St", city: "Accra" }), "GH");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing for a pickup order with no address", () => {
    const fetchMock = mockFetch({});

    saveBuyerAddressIfRequested(formData({ [SAVE_ADDRESS_FIELD]: "on", line1: "", city: "" }), "GH");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves the submitted address, extras included, with keepalive", () => {
    const fetchMock = mockFetch({});

    saveBuyerAddressIfRequested(
      formData({ [SAVE_ADDRESS_FIELD]: "on", line1: "12 Oxford St", city: "Accra", area: "Osu", region: "", digitalAddress: "ga1234567", landmark: "Blue gate" }),
      "GH",
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/buyer/addresses", expect.objectContaining({ method: "POST", keepalive: true }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ line1: "12 Oxford St", city: "Accra", country: "GH", digitalAddress: "GA-123-4567", landmark: "Blue gate" });
  });
});
