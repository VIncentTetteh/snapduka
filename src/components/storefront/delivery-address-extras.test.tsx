import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliveryAddressExtras, digitalAddressError, readDeliveryExtras } from "./delivery-address-extras";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readDeliveryExtras", () => {
  it("returns nothing for an untouched form", () => {
    expect(readDeliveryExtras(form({}), "GH")).toEqual({});
  });

  it("normalises the digital address and keeps a complete pin", () => {
    expect(
      readDeliveryExtras(
        form({ digitalAddress: "ga 123 4567", landmark: " Blue gate ", lat: "5.6", lng: "-0.18" }),
        "GH",
      ),
    ).toEqual({ digitalAddress: "GA-123-4567", landmark: "Blue gate", lat: 5.6, lng: -0.18 });
  });

  it("ignores a digital address outside Ghana", () => {
    expect(readDeliveryExtras(form({ digitalAddress: "GA-123-4567" }), "NG")).toEqual({});
  });
});

describe("digitalAddressError", () => {
  it("only complains about a malformed code", () => {
    expect(digitalAddressError(form({ digitalAddress: "" }), "GH")).toBeNull();
    expect(digitalAddressError(form({ digitalAddress: "GA-12" }), "GH")).toMatch(/GA-123-4567/);
  });
});

describe("DeliveryAddressExtras", () => {
  it("offers the GhanaPostGPS field only in Ghana", () => {
    const { rerender } = render(<DeliveryAddressExtras country="GH" />);
    expect(screen.getByLabelText("GhanaPostGPS address")).toBeInTheDocument();
    rerender(<DeliveryAddressExtras country="NG" />);
    expect(screen.queryByLabelText("GhanaPostGPS address")).not.toBeInTheDocument();
  });

  it("pins the buyer's location into hidden fields", () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 5.603712345, longitude: -0.187, accuracy: 12.4 } } as GeolocationPosition),
    );
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });

    const { container } = render(<DeliveryAddressExtras country="GH" />);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(screen.getByText(/Location pinned \(within about 12 m\)/)).toBeInTheDocument();
    expect(container.querySelector<HTMLInputElement>("input[name=lat]")?.value).toBe("5.603712");
  });

  it("explains a refused permission without blocking checkout", () => {
    const getCurrentPosition = vi.fn((_: PositionCallback, failure?: PositionErrorCallback | null) =>
      failure?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });

    const { container } = render(<DeliveryAddressExtras country="GH" />);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(screen.getByText(/permission was refused/)).toBeInTheDocument();
    expect(container.querySelector("input[name=lat]")).toBeNull();
  });
});
