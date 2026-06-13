import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyPaystackWebhook } from "@/lib/payments/webhook";

describe("verifyPaystackWebhook", () => {
  it("accepts only a matching sha512 signature", () => {
    const body = new TextEncoder().encode('{"event":"charge.success"}');
    const signature = createHmac("sha512", "secret").update(body).digest("hex");
    expect(verifyPaystackWebhook(body, signature, "secret")).toBe(true);
    expect(verifyPaystackWebhook(body, "bad", "secret")).toBe(false);
  });
});
