import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DeliveryAddress } from "@snapduka/core";

import { DeliveryAddressDetails } from "./delivery-address-details";

const BASE: DeliveryAddress = {
  line1: "4 Palm St",
  area: "Labone",
  city: "Accra",
  region: "Greater Accra",
  country: "GH",
  geoSource: "none",
};

describe("DeliveryAddressDetails", () => {
  it("renders nothing for a classic address", () => {
    const { container } = render(<DeliveryAddressDetails address={BASE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the code, the landmark and a map link", () => {
    render(
      <DeliveryAddressDetails
        address={{ ...BASE, digitalAddress: "GA-123-4567", landmark: "Blue gate", lat: 5.6, lng: -0.18, geoSource: "device" }}
      />,
    );
    expect(screen.getByText("GA-123-4567")).toBeInTheDocument();
    expect(screen.getByText("Blue gate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /pin in Maps/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=5.600000,-0.180000",
    );
  });
});
