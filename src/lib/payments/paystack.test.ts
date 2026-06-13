import { describe, expect, it, vi } from "vitest";

import { PaystackProvider } from "@/lib/payments/paystack";

describe("PaystackProvider", () => {
  it("initializes integer minor-unit amounts with a subaccount", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: { authorization_url: "https://checkout.paystack.com/x", access_code: "x", reference: "ref-1" },
    }), { status: 200 }));
    const provider = new PaystackProvider("sk_test_x", fetcher);
    await provider.initialize({
      email: "buyer@example.com", amountMinor: 12500, currency: "GHS",
      reference: "ref-1", subaccount: "ACCT_x", callbackUrl: "https://app.test/orders/token",
      metadata: { orderId: "order-1" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/initialize",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      amount: 12500, currency: "GHS", subaccount: "ACCT_x",
    });
  });
});
