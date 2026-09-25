// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CourierAdapterError, type BookRequest, type QuoteRequest } from "@snapduka/core";

import { createHttpTransport } from "./http";
import { manualAdapter } from "./manual";
import { createSandboxAdapter, SANDBOX_SIGNATURE_HEADER, sandboxPrice } from "./sandbox";
import { hmacSha256Hex, verifyHmacHeader } from "./shared";
import { createYangoAdapter } from "./yango";

const address = (city: string) => ({
  line1: "12 Oxford St",
  area: "Osu",
  city,
  region: "Greater Accra",
  country: "GH" as const,
  geoSource: "none" as const,
});

const QUOTE: QuoteRequest = {
  sellerAccountId: "s1",
  shopId: "shop1",
  country: "GH",
  currency: "GHS",
  pickup: address("Accra"),
  dropoff: address("Accra"),
  parcel: { valueMinor: 10_000, weightGrams: 500 },
};

const BOOK: BookRequest = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  orderId: "11111111-1111-4111-8111-111111111111",
  reference: "SD-ABC",
  sellerAccountId: "s1",
  country: "GH",
  currency: "GHS",
  pickup: address("Accra"),
  dropoff: address("Kumasi"),
  sender: { name: "Shop", phoneE164: "+233241234567" },
  recipient: { name: "Ama", phoneE164: "+233201234567" },
  parcel: { valueMinor: 10_000 },
};

const ctx = { credentials: null };

describe("sandbox adapter", () => {
  const sandbox = createSandboxAdapter({
    enabled: true,
    webhookSecret: "whsec",
    now: () => new Date("2026-09-25T10:00:00Z"),
  });

  it("prices deterministically from the request", async () => {
    const first = await sandbox.quote(QUOTE, ctx);
    const second = await sandbox.quote(QUOTE, ctx);
    expect(first).toEqual(second);
    expect(first.map((q) => q.service)).toEqual(["standard", "express"]);
    expect(first[0].amountMinor).toBe(1500);
    expect(first[0].expiresAt).toBe("2026-09-25T10:15:00.000Z");
  });

  it("charges more between cities and for heavy parcels", () => {
    expect(sandboxPrice({ ...QUOTE, dropoff: address("Kumasi") })).toBe(2500);
    expect(sandboxPrice({ ...QUOTE, parcel: { valueMinor: 1, weightGrams: 3200 } })).toBe(2100);
  });

  it("books idempotently: the same order gets the same booking", async () => {
    const first = await sandbox.book(BOOK, ctx);
    const second = await sandbox.book(BOOK, ctx);
    expect(second).toEqual(first);
    expect(first.providerBookingId).toMatch(/^sbx_[0-9a-f]{16}$/);
    expect(first.trackingNumber).toMatch(/^SBX-[0-9A-F]{8}$/);
  });

  it("is inert when not enabled", async () => {
    const off = createSandboxAdapter({ enabled: false, webhookSecret: "whsec" });
    expect(off.status()).toBe("not_configured");
    await expect(off.book(BOOK, ctx)).rejects.toMatchObject({ code: "not_configured" });
    const body = "{}";
    expect(
      await off.verifyWebhook({ rawBody: body, headers: { [SANDBOX_SIGNATURE_HEADER]: hmacSha256Hex("whsec", body) } }),
    ).toBe(false);
  });

  it("verifies webhook signatures over the raw body", async () => {
    const body = JSON.stringify({ events: [] });
    const good = hmacSha256Hex("whsec", body);
    expect(await sandbox.verifyWebhook({ rawBody: body, headers: { [SANDBOX_SIGNATURE_HEADER]: good } })).toBe(true);
    expect(
      await sandbox.verifyWebhook({ rawBody: `${body} `, headers: { [SANDBOX_SIGNATURE_HEADER]: good } }),
    ).toBe(false);
    expect(await sandbox.verifyWebhook({ rawBody: body, headers: {} })).toBe(false);
  });

  it("normalises webhook events and drops ones it cannot trust", () => {
    const rawBody = JSON.stringify({
      events: [
        { id: "e1", bookingId: "sbx_1", trackingNumber: "SBX-1", status: "delivered", occurredAt: "2026-09-25T11:00:00Z" },
        { id: "e2", status: "teleported" },
        { status: "in_transit" },
      ],
    });
    expect(sandbox.parseWebhook({ rawBody, headers: {} })).toEqual([
      {
        eventId: "e1",
        providerBookingId: "sbx_1",
        trackingNumber: "SBX-1",
        status: "delivered",
        occurredAt: "2026-09-25T11:00:00Z",
        description: null,
      },
    ]);
    expect(sandbox.parseWebhook({ rawBody: "not json", headers: {} })).toEqual([]);
  });
});

describe("manual adapter", () => {
  it("can do nothing, and says so", async () => {
    expect(Object.values(manualAdapter.capabilities).every((v) => v === false)).toBe(true);
    expect(await manualAdapter.quote(QUOTE, ctx)).toEqual([]);
    await expect(manualAdapter.book(BOOK, ctx)).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("yango adapter (awaiting partner access)", () => {
  it("stays not_configured even with env vars set", async () => {
    const yango = createYangoAdapter({ baseUrl: "https://example.test", apiKey: "k", webhookSecret: "s" });
    expect(yango.status()).toBe("not_configured");
    await expect(yango.quote(QUOTE, ctx)).rejects.toMatchObject({ code: "not_configured" });
    expect(await yango.verifyWebhook({ rawBody: "{}", headers: {} })).toBe(false);
  });
});

describe("http transport", () => {
  const make = (fetchImpl: typeof fetch) =>
    createHttpTransport({
      courierId: "p",
      baseUrl: "https://api.example.test/",
      apiKey: "key",
      idempotencyHeader: "idempotency-key",
      fetchImpl,
    });

  it("sends auth and idempotency headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: 1 }));
    const result = await make(fetchImpl).postJson<{ ok: number }>("/v1/book", { a: 1 }, { idempotencyKey: "order-1" });
    expect(result).toEqual({ ok: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/book");
    expect(init?.headers).toMatchObject({ authorization: "Bearer key", "idempotency-key": "order-1" });
  });

  it.each([
    [400, "rejected"],
    [422, "rejected"],
    [429, "unavailable"],
    [503, "unavailable"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status }));
    await expect(make(fetchImpl).getJson("/x")).rejects.toMatchObject({ code });
  });

  it("maps an abort to timeout and a network error to unavailable", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await expect(make(vi.fn<typeof fetch>().mockRejectedValue(abort)).getJson("/x")).rejects.toMatchObject({
      code: "timeout",
    });
    await expect(
      make(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"))).getJson("/x"),
    ).rejects.toBeInstanceOf(CourierAdapterError);
  });
});

describe("verifyHmacHeader", () => {
  it("accepts a sha256= prefix and refuses a missing secret", () => {
    const sig = hmacSha256Hex("s", "body");
    expect(verifyHmacHeader("s", "body", `sha256=${sig}`)).toBe(true);
    expect(verifyHmacHeader(undefined, "body", sig)).toBe(false);
  });
});
