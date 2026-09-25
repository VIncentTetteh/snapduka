import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCreatorPayoutDestination,
  creatorDestinationSubject,
  type CreatorDestinationRepository,
} from "./creator-destinations";
import { destinationFingerprint, type DestinationProvider } from "./destinations";

beforeEach(() => {
  process.env.PAYOUT_FINGERPRINT_SECRET = "test-secret-value";
});

const CREATOR = "22222222-2222-2222-2222-222222222222";

const input = {
  creatorId: CREATOR,
  currency: "GHS" as const,
  type: "mobile_money" as const,
  bankCode: "MTN",
  bankName: "MTN",
  accountNumber: "0551234987",
};

function harness(overrides: { resolve?: DestinationProvider["resolveAccount"] } = {}) {
  const resolveAccount = vi.fn(
    overrides.resolve ?? (async () => ({ accountName: "AMA MENSAH", accountNumber: "0551234987" })),
  );
  const createTransferRecipient = vi.fn(async () => ({ recipientCode: "RCP_creator", accountName: null }));
  const reserve = vi.fn<CreatorDestinationRepository["reserve"]>(async () => ({
    destinationId: "dest-c1",
    status: "pending",
  }));
  const activate = vi.fn<CreatorDestinationRepository["activate"]>(async () => undefined);
  const provider: DestinationProvider = { resolveAccount, createTransferRecipient };
  return { resolveAccount, createTransferRecipient, reserve, activate, deps: { provider, repository: { reserve, activate } } };
}

describe("createCreatorPayoutDestination", () => {
  it("resolves the holder's name first and names the recipient after it", async () => {
    const h = harness();
    const result = await createCreatorPayoutDestination(input, h.deps);

    expect(result).toEqual({ status: "active", destinationId: "dest-c1", accountName: "AMA MENSAH" });
    expect(h.resolveAccount).toHaveBeenCalledWith({ accountNumber: "0551234987", bankCode: "MTN" });
    expect(h.createTransferRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AMA MENSAH", accountNumber: "0551234987" }),
    );
    // Mobile money recipients often come back nameless; the resolved name is kept.
    expect(h.activate).toHaveBeenCalledWith({
      destinationId: "dest-c1",
      recipientCode: "RCP_creator",
      resolvedAccountName: "AMA MENSAH",
    });
  });

  it("reserves against the creator, never a seller, and stores only the last four digits", async () => {
    const h = harness();
    await createCreatorPayoutDestination(input, h.deps);

    expect(h.reserve).toHaveBeenCalledWith({
      creatorId: CREATOR,
      currency: "GHS",
      type: "mobile_money",
      bankCode: "MTN",
      bankName: "MTN",
      accountLast4: "4987",
      fingerprint: destinationFingerprint({
        sellerAccountId: creatorDestinationSubject(CREATOR),
        bankCode: "MTN",
        accountNumber: "0551234987",
        currency: "GHS",
      }),
    });
    expect(JSON.stringify(h.reserve.mock.calls)).not.toContain("0551234987");
  });

  it("uses a creator-scoped fingerprint subject, so a seller with the same id cannot collide", () => {
    const asCreator = destinationFingerprint({
      sellerAccountId: creatorDestinationSubject(CREATOR),
      bankCode: "MTN",
      accountNumber: "0551234987",
      currency: "GHS",
    });
    const asSeller = destinationFingerprint({
      sellerAccountId: CREATOR,
      bankCode: "MTN",
      accountNumber: "0551234987",
      currency: "GHS",
    });
    expect(asCreator).not.toBe(asSeller);
  });

  it("refuses an account Paystack cannot resolve, before reserving anything", async () => {
    const h = harness({
      resolve: async () => {
        throw new Error("Could not resolve account 0551234987");
      },
    });
    const result = await createCreatorPayoutDestination(input, h.deps);

    expect(result.status).toBe("error");
    // The provider's message can echo the number back into the page.
    expect(result.status === "error" && result.message).not.toContain("0551234987");
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.createTransferRecipient).not.toHaveBeenCalled();
  });

  it("refuses a malformed number without calling Paystack", async () => {
    const h = harness();
    const result = await createCreatorPayoutDestination({ ...input, accountNumber: "12ab" }, h.deps);
    expect(result.status).toBe("error");
    expect(h.resolveAccount).not.toHaveBeenCalled();
  });
});
