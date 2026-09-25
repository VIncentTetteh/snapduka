import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TRACES_SAMPLE_RATE,
  MONEY_TRACES_SAMPLE_RATE,
  createTracesSampler,
  defaultTracesSampleRate,
  isMoneyRoute,
  samplingPath,
} from "./sampling";
import { sharedSentryOptions } from "./sentry-options";
import { scrubEvent } from "./scrub";

describe("isMoneyRoute", () => {
  it.each([
    ["/api/payments/paystack/webhook", true],
    ["/api/payments", true],
    ["/api/internal/payouts/execute", true],
    ["/api/internal/protect/sweep", true],
    ["/api/internal/notifications/process", false],
    ["/api/checkout", false],
    ["/api/paymentsx", false],
  ])("%s -> %s", (path, expected) => {
    expect(isMoneyRoute(path)).toBe(expected);
  });
});

describe("samplingPath", () => {
  it("reads the path from the span name", () => {
    expect(samplingPath({ name: "POST /api/payments/paystack/webhook" })).toBe("/api/payments/paystack/webhook");
  });

  it("prefers OpenTelemetry attributes", () => {
    expect(samplingPath({ name: "GET", attributes: { "url.full": "https://a.b/api/internal/payouts/execute?x=1" } })).toBe(
      "/api/internal/payouts/execute",
    );
  });

  it("falls back to the normalized request", () => {
    expect(samplingPath({ name: "GET", normalizedRequest: { url: "https://a.b/api/payments/x" } })).toBe("/api/payments/x");
  });
});

describe("createTracesSampler", () => {
  it("always samples money routes, even against an unsampled parent", () => {
    const inherit = vi.fn(() => 0);
    expect(createTracesSampler(0.1)({ name: "POST /api/payments/paystack/webhook", inheritOrSampleWith: inherit })).toBe(
      MONEY_TRACES_SAMPLE_RATE,
    );
    expect(inherit).not.toHaveBeenCalled();
  });

  it("inherits the parent decision elsewhere, with the default as fallback", () => {
    const inherit = vi.fn((fallback: number) => fallback);
    expect(createTracesSampler(0.1)({ name: "GET /shop", inheritOrSampleWith: inherit })).toBe(0.1);
    expect(inherit).toHaveBeenCalledWith(0.1);
  });

  it("uses the default when the SDK gives no inherit helper", () => {
    expect(createTracesSampler(0.25)({ name: "GET /shop" })).toBe(0.25);
  });
});

describe("defaultTracesSampleRate", () => {
  it.each([
    [undefined, DEFAULT_TRACES_SAMPLE_RATE],
    ["", DEFAULT_TRACES_SAMPLE_RATE],
    ["0.5", 0.5],
    ["0", 0],
    ["1", 1],
    ["2", DEFAULT_TRACES_SAMPLE_RATE],
    ["-1", DEFAULT_TRACES_SAMPLE_RATE],
    ["ten percent", DEFAULT_TRACES_SAMPLE_RATE],
  ])("%s -> %s", (raw, expected) => {
    expect(defaultTracesSampleRate(raw)).toBe(expected);
  });
});

describe("sharedSentryOptions", () => {
  it("is null without a DSN so Sentry is never initialised", () => {
    expect(sharedSentryOptions({ dsn: undefined })).toBeNull();
    expect(sharedSentryOptions({ dsn: "  " })).toBeNull();
  });

  it("wires the scrubber and sampler and disables default PII", () => {
    const options = sharedSentryOptions({ dsn: "https://k@o0.ingest.sentry.io/1", environment: "preview" });
    expect(options).not.toBeNull();
    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.environment).toBe("preview");
    expect(options?.beforeSend).toBe(scrubEvent);
    expect(options?.beforeSendTransaction).toBe(scrubEvent);
    expect(options?.tracesSampler({ name: "GET /" })).toBe(DEFAULT_TRACES_SAMPLE_RATE);
  });
});
