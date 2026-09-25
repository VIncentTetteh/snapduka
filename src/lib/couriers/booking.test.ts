// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  loadCourierCredentials: vi.fn(),
  billable: true as boolean,
  rpc: vi.fn(),
}));

vi.mock("@/lib/couriers/credentials", () => ({ loadCourierCredentials: mocks.loadCourierCredentials }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.maybeSingle = () => Promise.resolve({ data: mocks.tables[table] ?? null, error: null });
      return builder;
    },
  }),
}));

import { CourierAdapterError, type CourierAdapter } from "@snapduka/core";

import { createSandboxAdapter } from "./adapters/sandbox";
import { bookOrderWithAdapter, type BookableOrder } from "./booking";

const ORDER: BookableOrder = {
  id: "33333333-3333-4333-8333-333333333333",
  shop_id: "shop-1",
  public_reference: "SD-XYZ",
  currency: "GHS",
  subtotal_minor: 9000,
  total_minor: 10_000,
  payment_method: "paystack",
  buyer_snapshot: {
    name: "Ama Mensah",
    phone: "+233201234567",
    address: { line1: "4 Palm St", area: "Labone", city: "Accra", region: "Greater Accra", digitalAddress: "ga1234567" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCourierCredentials.mockResolvedValue(null);
  mocks.billable = true;
  mocks.rpc.mockImplementation(async () => ({ data: mocks.billable, error: null }));
  mocks.tables = {
    shop_pickup_addresses: { address: { line1: "1 Ring Rd", city: "Accra" }, contact_phone: "+233241234567" },
    seller_accounts: { contact_phone: "+233240000000", contact_name: "Kofi" },
    shops: { display_name: "Kofi's Kicks" },
  };
});

describe("bookOrderWithAdapter", () => {
  it("books with the order id as the idempotency key", async () => {
    const adapter = createSandboxAdapter({ enabled: true });
    const book = vi.spyOn(adapter, "book");

    const outcome = await bookOrderWithAdapter({ adapter, order: ORDER, sellerAccountId: "seller-1", country: "GH" });

    expect(outcome.ok).toBe(true);
    const request = book.mock.calls[0][0];
    expect(request).toMatchObject({
      idempotencyKey: ORDER.id,
      reference: "SD-XYZ",
      sender: { name: "Kofi's Kicks", phoneE164: "+233241234567" },
      recipient: { name: "Ama Mensah", phoneE164: "+233201234567" },
      parcel: { valueMinor: 9000 },
      codAmountMinor: null,
    });
    expect(request.dropoff.digitalAddress).toBe("GA-123-4567");
  });

  it("asks the rider to collect the full total on a cash order", async () => {
    const adapter = createSandboxAdapter({ enabled: true });
    const book = vi.spyOn(adapter, "book");
    await bookOrderWithAdapter({
      adapter,
      order: { ...ORDER, payment_method: "cash_on_delivery" },
      sellerAccountId: "seller-1",
      country: "GH",
    });
    expect(book.mock.calls[0][0].codAmountMinor).toBe(10_000);
  });

  it("refuses a cash order for a courier that cannot collect cash", async () => {
    const sandbox = createSandboxAdapter({ enabled: true });
    const adapter: CourierAdapter = { ...sandbox, capabilities: { ...sandbox.capabilities, cod: false } };
    const outcome = await bookOrderWithAdapter({
      adapter,
      order: { ...ORDER, payment_method: "cash_on_delivery" },
      sellerAccountId: "seller-1",
      country: "GH",
    });
    expect(outcome).toMatchObject({ ok: false, reason: "courier_rejected" });
  });

  it("needs a pickup address", async () => {
    mocks.tables.shop_pickup_addresses = null;
    const outcome = await bookOrderWithAdapter({
      adapter: createSandboxAdapter({ enabled: true }),
      order: ORDER,
      sellerAccountId: "seller-1",
      country: "GH",
    });
    expect(outcome).toMatchObject({ ok: false, reason: "no_pickup_address" });
  });

  it("maps partner failures to retryable and final", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sandbox = createSandboxAdapter({ enabled: true });
    const down: CourierAdapter = {
      ...sandbox,
      book: () => Promise.reject(new CourierAdapterError("sandbox", "timeout", "slow")),
    };
    const refused: CourierAdapter = {
      ...sandbox,
      book: () => Promise.reject(new CourierAdapterError("sandbox", "rejected", "no")),
    };
    const args = { order: ORDER, sellerAccountId: "seller-1", country: "GH" as const };
    expect(await bookOrderWithAdapter({ adapter: down, ...args })).toMatchObject({ reason: "courier_unavailable" });
    expect(await bookOrderWithAdapter({ adapter: refused, ...args })).toMatchObject({ reason: "courier_rejected" });
  });

  it("on SnapDuka's platform account, checks the order can pay for the delivery and marks it for charging", async () => {
    mocks.tables.courier_quotes = { amount_minor: 1500 };
    const adapter = createSandboxAdapter({ enabled: true });

    const outcome = await bookOrderWithAdapter({ adapter, order: ORDER, sellerAccountId: "seller-1", country: "GH" });

    expect(mocks.rpc).toHaveBeenCalledWith("courier_booking_billable", { p_order_id: ORDER.id, p_estimate_minor: 1500 });
    expect(outcome).toMatchObject({ ok: true, platformCharge: { estimateMinor: 1500 } });
  });

  it("refuses a platform booking the order cannot pay for, without calling the courier", async () => {
    mocks.billable = false;
    const adapter = createSandboxAdapter({ enabled: true });
    const book = vi.spyOn(adapter, "book");

    const outcome = await bookOrderWithAdapter({ adapter, order: ORDER, sellerAccountId: "seller-1", country: "GH" });

    expect(outcome).toMatchObject({ ok: false, reason: "not_billable" });
    expect(book).not.toHaveBeenCalled();
  });

  it("does not charge when the seller's own courier account is used", async () => {
    mocks.loadCourierCredentials.mockResolvedValue({ apiKey: "seller-own" });
    const adapter = createSandboxAdapter({ enabled: true });

    const outcome = await bookOrderWithAdapter({ adapter, order: ORDER, sellerAccountId: "seller-1", country: "GH" });

    expect(outcome).toMatchObject({ ok: true, platformCharge: null });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
