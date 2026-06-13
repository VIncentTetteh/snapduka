import { expect, test } from "@playwright/test";

test("offline order retries are idempotent and produce a secure receipt", async ({ request }) => {
  test.setTimeout(60_000);
  const payload = {
    shopId: "11111111-1111-4111-8111-111111111113",
    fulfillmentMethodId: "11111111-1111-4111-8111-111111111115",
    idempotencyKey: "e2e-offline-checkout-0001",
    paymentMethod: "cash_on_delivery",
    buyer: {
      name: "Kojo Buyer", email: "kojo@example.com", phone: "0241234567", country: "GH",
      address: { line1: "1 Test Road", area: "Osu", city: "Accra", region: "Greater Accra" },
      marketingConsent: false,
    },
    lines: [{ productId: "11111111-1111-4111-8111-111111111114", quantity: 1 }],
  };
  const first = await request.post("/api/checkout/orders", { data: payload });
  const second = await request.post("/api/checkout/orders", { data: payload });
  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);
  const firstBody = await first.json();
  const secondBody = await second.json();
  expect(secondBody.orderId).toBe(firstBody.orderId);
  const receipt = await request.get(`/api/orders/${firstBody.trackingToken}`);
  expect(receipt.status()).toBe(200);
  expect((await receipt.json()).payment_status).toBe("offline_due");
});
