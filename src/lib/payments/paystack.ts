import type { InitializePaymentInput, PaymentProvider } from "@/lib/payments/types";

type Fetcher = typeof fetch;

export class PaystackProvider implements PaymentProvider {
  constructor(private secret: string, private fetcher: Fetcher = fetch) {}

  private async request(path: string, init?: RequestInit) {
    const response = await this.fetcher(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.secret}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const payload = await response.json();
    if (!response.ok || !payload.status) throw new Error(payload.message ?? "Paystack request failed.");
    return payload.data;
  }

  async initialize(input: InitializePaymentInput) {
    const data = await this.request("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        subaccount: input.subaccount,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
  }

  async verify(reference: string) {
    const data = await this.request(`/transaction/verify/${encodeURIComponent(reference)}`);
    return { status: data.status, amountMinor: data.amount, currency: data.currency, reference: data.reference };
  }

  async refund(input: { reference: string; amountMinor?: number }) {
    const data = await this.request("/refund", {
      method: "POST",
      body: JSON.stringify({ transaction: input.reference, amount: input.amountMinor }),
    });
    return { providerId: String(data.id), status: data.status };
  }
}

export function paystackProvider() {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("Paystack is not configured.");
  return new PaystackProvider(secret);
}
