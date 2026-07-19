import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => {
  const lookup = vi.fn();
  return { default: { lookup }, lookup };
});

import { lookup } from "node:dns/promises";
import { isSafeWebhookUrl } from "./url";

describe("isSafeWebhookUrl", () => {
  it("rejects a javascript: URL without a DNS lookup", async () => {
    expect(await isSafeWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a hostname literally named localhost", async () => {
    expect(await isSafeWebhookUrl("http://localhost:3000/hook")).toBe(false);
  });

  it("rejects a public-looking hostname that resolves to a private IP (DNS rebinding)", async () => {
    vi.mocked(lookup).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("rejects a hostname resolving to the cloud metadata address", async () => {
    vi.mocked(lookup).mockResolvedValue({ address: "169.254.169.254", family: 4 });
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("accepts a hostname resolving to a real public IP", async () => {
    vi.mocked(lookup).mockResolvedValue({ address: "93.184.216.34", family: 4 });
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(true);
  });

  it("rejects a hostname that fails to resolve", async () => {
    vi.mocked(lookup).mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isSafeWebhookUrl("https://nonexistent.example.invalid/hook")).toBe(false);
  });
});
