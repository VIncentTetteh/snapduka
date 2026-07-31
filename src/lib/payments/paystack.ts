import type { InitializePaymentInput, PaymentProvider } from "@/lib/payments/types";

type Fetcher = typeof fetch;

/**
 * Paystack received the request and refused it.
 *
 * The distinction from a network error is not cosmetic: a refusal proves
 * nothing happened on their side, so the caller may safely retry or give up.
 * A network error proves nothing at all — the request may well have been
 * processed — so the caller must go and ask rather than assume.
 */
export class PaystackApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PaystackApiError";
  }
}

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
    if (!response.ok || !payload.status) {
      throw new PaystackApiError(payload.message ?? "Paystack request failed.", response.status);
    }
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

  /**
   * Changes an existing subaccount's split.
   *
   * Paystack stores percentage_charge on the subaccount at creation, so a
   * platform-fee change does not reach sellers who have already onboarded
   * unless it is pushed here. Returns the rate Paystack echoes back rather than
   * the one sent, so the caller records what the provider actually accepted.
   */
  async updateSubaccount(subaccountCode: string, input: { percentageCharge: number }) {
    const data = await this.request(`/subaccount/${encodeURIComponent(subaccountCode)}`, {
      method: "PUT",
      body: JSON.stringify({ percentage_charge: input.percentageCharge }),
    });
    return {
      subaccountCode: data.subaccount_code as string,
      percentageCharge: Number(data.percentage_charge),
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

  /**
   * Asks Paystack whose account a number belongs to, so a seller can confirm
   * the name before we ever send money there.
   */
  async resolveAccount(input: { accountNumber: string; bankCode: string }) {
    const data = await this.request(
      `/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`,
    );
    return { accountName: String(data.account_name), accountNumber: String(data.account_number) };
  }

  /**
   * Exchanges an account number for an opaque recipient code.
   *
   * This is the only place the full number exists in our process. It is passed
   * straight through and never returned, logged or persisted — everything
   * downstream works from the recipient code alone.
   */
  async createTransferRecipient(input: {
    type: "bank" | "mobile_money";
    name: string;
    accountNumber: string;
    bankCode: string;
    currency: string;
  }) {
    const data = await this.request("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({
        // Paystack's Ghana types: 'ghipss' for bank accounts, 'mobile_money' for wallets.
        type: input.type === "mobile_money" ? "mobile_money" : "ghipss",
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: input.currency,
      }),
    });
    return {
      recipientCode: String(data.recipient_code),
      accountName: (data.details?.account_name as string | undefined) ?? null,
    };
  }

  /**
   * Sends money from the main Paystack balance.
   *
   * `reference` is our own payout reference. Paystack treats it as idempotent,
   * so a retry after a timeout returns the existing transfer rather than
   * sending a second one — which is what makes a crash between the call and our
   * DB write recoverable rather than expensive.
   */
  async createTransfer(input: {
    amountMinor: number;
    recipientCode: string;
    reference: string;
    reason?: string;
    currency: string;
  }) {
    const data = await this.request("/transfer", {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: input.amountMinor,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason ?? "SnapDuka withdrawal",
        currency: input.currency,
      }),
    });
    return {
      transferCode: String(data.transfer_code),
      transferId: String(data.id),
      // 'otp' means the integration still requires per-transfer confirmation.
      // Callers must treat it as a hard failure, never try to solve it.
      status: String(data.status),
    };
  }

  /**
   * Asks what happened to a transfer we may or may not have recorded.
   * The recovery path when we crashed between sending and writing.
   */
  async verifyTransfer(reference: string) {
    const data = await this.request(`/transfer/verify/${encodeURIComponent(reference)}`);
    return {
      transferCode: String(data.transfer_code),
      transferId: String(data.id),
      status: String(data.status),
      amountMinor: Number(data.amount),
    };
  }

  /** Real balance at Paystack, for reconciling against the ledger. */
  async balances() {
    const data = await this.request("/balance");
    return (data as Array<{ currency: string; balance: number }>).map((row) => ({
      currency: row.currency,
      balanceMinor: Number(row.balance),
    }));
  }
}

export function paystackProvider() {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("Paystack is not configured.");
  return new PaystackProvider(secret);
}
