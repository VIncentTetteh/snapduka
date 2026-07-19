import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => {
  const lookup = vi.fn();
  return { default: { lookup }, lookup };
});

import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isSafeWebhookUrl } from "./url";

// `lookup` is overloaded; the source always calls it with `{ all: true }`,
// which resolves to the array-returning overload — pin the mock to that
// shape instead of letting `vi.mocked()` infer the single-result default.
const mockedLookup = vi.mocked(
  lookup as unknown as (hostname: string, options: { all: true }) => Promise<LookupAddress[]>,
);

describe("isSafeWebhookUrl", () => {
  it("rejects a javascript: URL without a DNS lookup", async () => {
    expect(await isSafeWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("rejects a hostname literally named localhost", async () => {
    expect(await isSafeWebhookUrl("http://localhost:3000/hook")).toBe(false);
  });

  it("rejects a public-looking hostname that resolves to a private IP (DNS rebinding)", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("rejects a hostname resolving to the cloud metadata address", async () => {
    mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("accepts a hostname resolving to a real public IP", async () => {
    mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(true);
  });

  it("rejects a hostname that fails to resolve", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isSafeWebhookUrl("https://nonexistent.example.invalid/hook")).toBe(false);
  });

  it("rejects when ANY resolved address is private, even if another is public", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("rejects an IPv4-mapped IPv6 address pointing at loopback (::ffff:127.0.0.1)", async () => {
    mockedLookup.mockResolvedValue([{ address: "::ffff:7f00:1", family: 6 }]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("rejects an IPv4-mapped IPv6 address pointing at the cloud metadata address", async () => {
    mockedLookup.mockResolvedValue([{ address: "::ffff:169.254.169.254", family: 6 }]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("rejects a bare IPv6 unique-local address", async () => {
    mockedLookup.mockResolvedValue([{ address: "fd00::1", family: 6 }]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("accepts a real public IPv6 address", async () => {
    mockedLookup.mockResolvedValue([{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(true);
  });
});
