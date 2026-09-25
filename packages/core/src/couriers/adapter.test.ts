import { describe, expect, it } from "vitest";

import { applyDeliveryMargin, CourierAdapterError, isShipmentStatus } from "./adapter";

describe("applyDeliveryMargin", () => {
  it("adds nothing at 0 bps", () => {
    expect(applyDeliveryMargin(2500, 0)).toBe(2500);
  });

  it("adds the margin in basis points", () => {
    expect(applyDeliveryMargin(2000, 1000)).toBe(2200);
  });

  it("rounds the margin up, never down", () => {
    // 1001 * 1% = 10.01 -> 11
    expect(applyDeliveryMargin(1001, 100)).toBe(1012);
  });

  it("treats a negative margin as none", () => {
    expect(applyDeliveryMargin(1000, -500)).toBe(1000);
  });

  it("refuses a negative price", () => {
    expect(() => applyDeliveryMargin(-1, 0)).toThrow(RangeError);
  });
});

describe("CourierAdapterError", () => {
  it("marks only transient failures as retryable", () => {
    expect(new CourierAdapterError("x", "timeout", "t").retryable).toBe(true);
    expect(new CourierAdapterError("x", "unavailable", "u").retryable).toBe(true);
    expect(new CourierAdapterError("x", "rejected", "r").retryable).toBe(false);
    expect(new CourierAdapterError("x", "not_configured", "n").retryable).toBe(false);
  });
});

describe("isShipmentStatus", () => {
  it("accepts the states shipments_status_check accepts", () => {
    expect(isShipmentStatus("delivered")).toBe(true);
    expect(isShipmentStatus("lost")).toBe(false);
    expect(isShipmentStatus(3)).toBe(false);
  });
});
