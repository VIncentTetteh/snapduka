import { beforeEach, describe, expect, it, vi } from "vitest";

// Matches src/lib/internal-jobs/auth.test.ts: the real server-only package
// throws unconditionally outside webpack.
vi.mock("server-only", () => ({}));

import {
  accountLast4,
  createPayoutDestination,
  destinationFingerprint,
  fingerprintsMatch,
  isValidAccountNumber,
  type DestinationProvider,
  type DestinationRepository,
} from "./destinations";

beforeEach(() => {
  process.env.PAYOUT_FINGERPRINT_SECRET = "test-secret-value";
});

const base = {
  sellerAccountId: "11111111-1111-1111-1111-111111111111",
  currency: "GHS",
  type: "mobile_money" as const,
  bankCode: "MTN",
  bankName: "MTN",
  accountNumber: "0551234987",
  accountName: "Sika Threads",
};

function harness(
  overrides: {
    reserve?: ReturnType<typeof vi.fn>;
    createRecipient?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const activate = vi.fn().mockResolvedValue(undefined);
  const reserve =
    overrides.reserve ??
    vi.fn().mockResolvedValue({ destinationId: "dest-1", status: "pending" });
  const createTransferRecipient =
    overrides.createRecipient ??
    vi.fn().mockResolvedValue({ recipientCode: "RCP_abc", accountName: "SIKA THREADS" });

  return {
    activate,
    reserve,
    createTransferRecipient,
    deps: {
      provider: {
        resolveAccount: vi.fn(),
        createTransferRecipient,
      } as unknown as DestinationProvider,
      repository: { reserve, activate } as unknown as DestinationRepository,
    },
  };
}

describe("destinationFingerprint", () => {
  it("is stable for the same details", () => {
    expect(destinationFingerprint(base)).toBe(destinationFingerprint(base));
  });

  it("changes when any part of the destination changes", () => {
    const original = destinationFingerprint(base);
    expect(destinationFingerprint({ ...base, accountNumber: "0551234988" })).not.toBe(original);
    expect(destinationFingerprint({ ...base, bankCode: "VOD" })).not.toBe(original);
    expect(destinationFingerprint({ ...base, currency: "NGN" })).not.toBe(original);
    // Two sellers with the same bank details must not collide, or one could
    // resume the other's reservation.
    expect(
      destinationFingerprint({ ...base, sellerAccountId: "22222222-2222-2222-2222-222222222222" }),
    ).not.toBe(original);
  });

  // The whole reason this is keyed: a 10-digit account inside a known bank is a
  // ~10^10 keyspace, so an unkeyed digest is brute-forced in seconds.
  it("depends on the server secret, so a leaked digest cannot be brute-forced", () => {
    const withFirst = destinationFingerprint(base);
    process.env.PAYOUT_FINGERPRINT_SECRET = "a-different-secret";
    expect(destinationFingerprint(base)).not.toBe(withFirst);
  });

  it("refuses to run unconfigured rather than falling back to an unkeyed hash", () => {
    delete process.env.PAYOUT_FINGERPRINT_SECRET;
    delete process.env.INTERNAL_JOB_SECRET;
    expect(() => destinationFingerprint(base)).toThrow(/not configured/i);
  });
});

describe("input helpers", () => {
  it("accepts realistic account and mobile money numbers", () => {
    expect(isValidAccountNumber("0551234987")).toBe(true);
    expect(isValidAccountNumber("123456")).toBe(true);
  });

  it("rejects anything that is not 6-20 digits", () => {
    expect(isValidAccountNumber("12345")).toBe(false);
    expect(isValidAccountNumber("055-123-4987")).toBe(false);
    expect(isValidAccountNumber("")).toBe(false);
  });

  it("takes the last four digits for display", () => {
    expect(accountLast4("0551234987")).toBe("4987");
  });

  it("compares fingerprints without leaking length mismatches as a throw", () => {
    const a = destinationFingerprint(base);
    expect(fingerprintsMatch(a, a)).toBe(true);
    expect(fingerprintsMatch(a, "short")).toBe(false);
  });
});

describe("createPayoutDestination", () => {
  it("exchanges the number for a recipient code and activates", async () => {
    const h = harness();
    const result = await createPayoutDestination(base, h.deps);

    expect(result).toEqual({ status: "active", destinationId: "dest-1", accountName: "SIKA THREADS" });
    expect(h.activate).toHaveBeenCalledWith({
      destinationId: "dest-1",
      recipientCode: "RCP_abc",
      resolvedAccountName: "SIKA THREADS",
    });
  });

  // The account number must reach Paystack and nowhere else.
  it("never passes the full account number to the repository", async () => {
    const h = harness();
    await createPayoutDestination(base, h.deps);

    const reserved = h.reserve.mock.calls[0][0];
    expect(JSON.stringify(reserved)).not.toContain(base.accountNumber);
    expect(reserved.accountLast4).toBe("4987");
  });

  it("rejects an invalid number before it reaches the provider", async () => {
    const h = harness();
    const result = await createPayoutDestination({ ...base, accountNumber: "abc" }, h.deps);

    expect(result.status).toBe("error");
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.createTransferRecipient).not.toHaveBeenCalled();
  });

  it("returns early when this exact destination is already active", async () => {
    const h = harness({
      reserve: vi.fn().mockResolvedValue({ destinationId: "dest-existing", status: "active" }),
    });
    const result = await createPayoutDestination(base, h.deps);

    expect(result).toMatchObject({ status: "active", destinationId: "dest-existing" });
    // Re-submitting unchanged details must not mint a second Paystack recipient.
    expect(h.createTransferRecipient).not.toHaveBeenCalled();
  });

  // The reserved row stays pending with the same fingerprint, so resubmitting
  // resumes rather than duplicating.
  it("leaves the reservation recoverable when the provider rejects the details", async () => {
    const h = harness({
      createRecipient: vi.fn().mockRejectedValue(new Error("Invalid account number")),
    });
    const result = await createPayoutDestination(base, h.deps);

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toMatch(/Invalid account number/);
    expect(h.activate).not.toHaveBeenCalled();
  });

  it("surfaces a reservation failure without calling the provider", async () => {
    const h = harness({
      reserve: vi.fn().mockRejectedValue(new Error("Verified seller status is required.")),
    });
    const result = await createPayoutDestination(base, h.deps);

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toMatch(/Verified seller/);
    expect(h.createTransferRecipient).not.toHaveBeenCalled();
  });
});
