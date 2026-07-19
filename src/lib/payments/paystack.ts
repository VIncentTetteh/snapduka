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

  async initializeSubscription(input: { email: string; amountMinor: number; currency: string; reference: string; planCode: string; callbackUrl: string; metadata: Record<string, unknown> }) {
    const data = await this.request("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        plan: input.planCode,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    return { authorizationUrl: data.authorization_url as string, reference: data.reference as string };
  }

  /** Creates a recurring billing plan; the returned plan_code is stored on
   * plan_prices so it is only created once per price. */
  async createPlan(input: { name: string; interval: "monthly" | "annually"; amountMinor: number; currency: string }) {
    const data = await this.request("/plan", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        interval: input.interval,
        amount: input.amountMinor,
        currency: input.currency,
      }),
    });
    return { planCode: data.plan_code as string };
  }

  async disableSubscription(code: string, token: string) {
    await this.request("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({ code, token }),
    });
  }

  /** Subscribes an already-charged customer to a plan using a stored card
   * authorization — no checkout redirect needed. Used by the plan-change
   * cron to apply a scheduled downgrade without a live seller session. */
  async createSubscriptionForAuthorization(input: { customerCode: string; planCode: string; authorizationCode: string }) {
    const data = await this.request("/subscription", {
      method: "POST",
      body: JSON.stringify({
        customer: input.customerCode,
        plan: input.planCode,
        authorization: input.authorizationCode,
      }),
    });
    return { subscriptionCode: data.subscription_code as string, emailToken: data.email_token as string };
  }

  async createSubaccount(input: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
    percentageCharge: number;
  }) {
    const data = await this.request("/subaccount", {
      method: "POST",
      body: JSON.stringify({
        business_name: input.businessName,
        settlement_bank: input.bankCode,
        account_number: input.accountNumber,
        percentage_charge: input.percentageCharge,
      }),
    });
    return {
      providerId: String(data.id),
      subaccountCode: data.subaccount_code as string,
    };
  }

  async verify(reference: string) {
    const data = await this.request(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: data.status,
      amountMinor: data.amount,
      currency: data.currency,
      reference: data.reference,
      authorizationCode: (data.authorization?.authorization_code as string | undefined) ?? null,
      customerCode: (data.customer?.customer_code as string | undefined) ?? null,
    };
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
