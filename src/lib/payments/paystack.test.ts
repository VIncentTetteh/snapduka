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

describe("PaystackProvider.createSubscriptionForAuthorization", () => {
  it("subscribes an existing customer to a plan using a stored card authorization", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: { subscription_code: "SUB_x", email_token: "tok_x" },
    }), { status: 200 }));
    const provider = new PaystackProvider("sk_test_x", fetcher);
    const result = await provider.createSubscriptionForAuthorization({
      customerCode: "CUS_1", planCode: "PLN_1", authorizationCode: "AUTH_1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.paystack.co/subscription",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      customer: "CUS_1", plan: "PLN_1", authorization: "AUTH_1",
    });
    expect(result).toEqual({ subscriptionCode: "SUB_x", emailToken: "tok_x" });
  });
});

describe("PaystackProvider.verify", () => {
  it("returns the authorization and customer codes from the transaction", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: {
        status: "success", amount: 6000, currency: "GHS", reference: "ref-1",
        authorization: { authorization_code: "AUTH_1" },
        customer: { customer_code: "CUS_1" },
      },
    }), { status: 200 }));
    const provider = new PaystackProvider("sk_test_x", fetcher);
    const result = await provider.verify("ref-1");
    expect(result).toEqual({
      status: "success", amountMinor: 6000, currency: "GHS", reference: "ref-1",
      authorizationCode: "AUTH_1", customerCode: "CUS_1",
    });
  });

  it("returns null authorization/customer codes when Paystack omits them", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: { status: "success", amount: 6000, currency: "GHS", reference: "ref-1" },
    }), { status: 200 }));
    const provider = new PaystackProvider("sk_test_x", fetcher);
    const result = await provider.verify("ref-1");
    expect(result.authorizationCode).toBeNull();
    expect(result.customerCode).toBeNull();
  });
});
