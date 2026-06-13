import { describe, expect, it } from "vitest";

import { nextAttemptAt, shouldSendWhatsApp } from "@/lib/notifications/outbox";

describe("notification outbox", () => {
  it("backs off retries and dead-letters after five attempts", () => {
    expect(nextAttemptAt(new Date("2026-01-01T00:00:00Z"), 2)?.toISOString()).toBe("2026-01-01T00:04:00.000Z");
    expect(nextAttemptAt(new Date(), 5)).toBeNull();
  });
  it("requires explicit valid consent for WhatsApp", () => {
    expect(shouldSendWhatsApp("granted", true)).toBe(true);
    expect(shouldSendWhatsApp("withdrawn", true)).toBe(false);
    expect(shouldSendWhatsApp("granted", false)).toBe(false);
  });
});
