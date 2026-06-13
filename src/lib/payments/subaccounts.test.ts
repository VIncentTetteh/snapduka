import { describe, expect, it, vi } from "vitest";

import {
  createPaymentSubaccount,
  paymentRequestFingerprint,
  type PaymentSubaccountProvider,
  type PaymentSubaccountRepository,
  type PaymentSubaccountRequest,
} from "./subaccounts";

const request: PaymentSubaccountRequest = {
  authUserId: "00000000-0000-0000-0000-000000000101",
  sellerAccountId: "00000000-0000-0000-0000-000000000201",
  country: "GH",
  businessName: "Ama Market Limited",
  bankCode: "GH001",
  bankName: "Example Bank",
  accountNumber: "0123456789",
  percentageCharge: 10,
};

function provider(): PaymentSubaccountProvider & {
  create: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn().mockResolvedValue({
      providerId: "provider-123",
      subaccountCode: "ACCT_123",
    }),
  };
}

function repository(
  overrides: Partial<PaymentSubaccountRepository> = {},
): PaymentSubaccountRepository {
  return {
    findActive: vi.fn().mockResolvedValue(null),
    reserve: vi.fn().mockResolvedValue({
      kind: "reserved",
      reservationId: "reservation-123",
    }),
    recordProviderResult: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createPaymentSubaccount", () => {
  it.each([
    ["country", { country: null }],
    ["settlement", { accountNumber: "" }],
  ] as const)("refuses creation when %s prerequisites are incomplete", async (_, patch) => {
    const paymentProvider = provider();

    const result = await createPaymentSubaccount(
      { ...request, ...patch },
      {
        provider: paymentProvider,
        repository: repository(),
      },
    );

    expect(result.status).toBe("blocked");
    expect(paymentProvider.create).not.toHaveBeenCalled();
  });

  it("returns an existing active provider record without a duplicate call", async () => {
    const paymentProvider = provider();
    const existing = {
      providerId: "provider-existing",
      subaccountCode: "ACCT_EXISTING",
    };

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repository({
        findActive: vi.fn().mockResolvedValue(existing),
      }),
    });

    expect(result).toEqual({
      status: "active",
      created: false,
      ...existing,
    });
    expect(paymentProvider.create).not.toHaveBeenCalled();
  });

  it("does not call the provider when another request owns the reservation", async () => {
    const paymentProvider = provider();

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repository({
        reserve: vi.fn().mockResolvedValue({ kind: "in_progress" }),
      }),
    });

    expect(result).toEqual({ status: "in_progress" });
    expect(paymentProvider.create).not.toHaveBeenCalled();
  });

  it("persists only safe settlement metadata after provider creation", async () => {
    const paymentProvider = provider();
    const repo = repository();

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repo,
    });

    expect(result).toEqual({
      status: "active",
      created: true,
      providerId: "provider-123",
      subaccountCode: "ACCT_123",
    });
    expect(paymentProvider.create).toHaveBeenCalledWith({
      businessName: request.businessName,
      bankCode: request.bankCode,
      accountNumber: request.accountNumber,
      percentageCharge: 10,
    });
    expect(repo.recordProviderResult).toHaveBeenCalledWith(
      expect.objectContaining({
        authUserId: request.authUserId,
        sellerAccountId: request.sellerAccountId,
        reservationId: "reservation-123",
        result: {
          providerId: "provider-123",
          subaccountCode: "ACCT_123",
          metadata: {
            bankCode: "GH001",
            bankName: "Example Bank",
            accountLast4: "6789",
            country: "GH",
          },
        },
      }),
    );
    expect(repo.activate).toHaveBeenCalledWith({
      authUserId: request.authUserId,
      sellerAccountId: request.sellerAccountId,
      reservationId: "reservation-123",
    });
    expect(
      JSON.stringify(vi.mocked(repo.recordProviderResult).mock.calls),
    ).not.toContain(request.accountNumber);
  });

  it("uses a deterministic fingerprint without embedding the account number", () => {
    const first = paymentRequestFingerprint(request);
    const second = paymentRequestFingerprint({ ...request });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(request.accountNumber);
  });

  it("releases the reservation and returns a safe error when the provider fails", async () => {
    const paymentProvider = provider();
    paymentProvider.create.mockRejectedValue(
      new Error("provider leaked secret detail"),
    );
    const repo = repository();

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repo,
    });

    expect(result).toEqual({
      status: "error",
      message: "We could not create the payment account. Please try again.",
    });
    expect(repo.release).toHaveBeenCalledWith("reservation-123");
  });

  it("returns a safe typed error when payment persistence is unavailable", async () => {
    const paymentProvider = provider();

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repository({
        findActive: vi
          .fn()
          .mockRejectedValue(new Error("database connection detail")),
      }),
    });

    expect(result).toEqual({
      status: "error",
      message: "We could not create the payment account. Please try again.",
    });
    expect(paymentProvider.create).not.toHaveBeenCalled();
  });

  it("retries activation three times and returns reconciliation required without releasing", async () => {
    const paymentProvider = provider();
    const repo = repository({
      activate: vi.fn().mockRejectedValue(new Error("activation write failed")),
    });

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repo,
    });

    expect(result).toEqual({
      status: "reconciliation_required",
      message:
        "Payment setup is processing. It will be reconciled without creating another provider account.",
    });
    expect(paymentProvider.create).toHaveBeenCalledOnce();
    expect(repo.recordProviderResult).toHaveBeenCalledOnce();
    expect(repo.activate).toHaveBeenCalledTimes(3);
    expect(repo.release).not.toHaveBeenCalled();
  });

  it("retries provider result persistence three times before activation", async () => {
    const paymentProvider = provider();
    const repo = repository({
      recordProviderResult: vi
        .fn()
        .mockRejectedValueOnce(new Error("write failed"))
        .mockRejectedValueOnce(new Error("write failed"))
        .mockResolvedValueOnce(undefined),
    });

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repo,
    });

    expect(result).toMatchObject({ status: "active", created: true });
    expect(repo.recordProviderResult).toHaveBeenCalledTimes(3);
    expect(repo.activate).toHaveBeenCalledOnce();
  });

  it("does not call the provider again after a retained reservation", async () => {
    const paymentProvider = provider();
    const repo = repository({
      reserve: vi.fn().mockResolvedValue({ kind: "in_progress" }),
    });

    const result = await createPaymentSubaccount(request, {
      provider: paymentProvider,
      repository: repo,
    });

    expect(result).toEqual({ status: "in_progress" });
    expect(paymentProvider.create).not.toHaveBeenCalled();
    expect(repo.activate).not.toHaveBeenCalled();
  });

  it("recovers a persisted provider result on retry without creating twice", async () => {
    const paymentProvider = provider();
    let providerResult:
      | {
          providerId: string;
          subaccountCode: string;
          metadata: {
            bankCode: string;
            bankName: string;
            accountLast4: string;
            country: "GH";
          };
        }
      | undefined;
    let activationAttempts = 0;
    const repo = repository({
      reserve: vi.fn().mockImplementation(async () => {
        if (providerResult) {
          return {
            kind: "provider_created" as const,
            reservationId: "reservation-123",
            result: providerResult,
          };
        }

        return {
          kind: "reserved" as const,
          reservationId: "reservation-123",
        };
      }),
      recordProviderResult: vi.fn().mockImplementation(async ({ result }) => {
        providerResult = result;
      }),
      activate: vi.fn().mockImplementation(async () => {
        activationAttempts += 1;
        if (activationAttempts <= 3) {
          throw new Error("activation write failed");
        }
      }),
    });

    await expect(
      createPaymentSubaccount(request, {
        provider: paymentProvider,
        repository: repo,
      }),
    ).resolves.toMatchObject({ status: "reconciliation_required" });

    await expect(
      createPaymentSubaccount(request, {
        provider: paymentProvider,
        repository: repo,
      }),
    ).resolves.toEqual({
      status: "active",
      created: false,
      providerId: "provider-123",
      subaccountCode: "ACCT_123",
    });

    expect(paymentProvider.create).toHaveBeenCalledOnce();
    expect(repo.recordProviderResult).toHaveBeenCalledOnce();
    expect(repo.activate).toHaveBeenCalledTimes(4);
    expect(repo.release).not.toHaveBeenCalled();
  });
});
