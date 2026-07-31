import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Payout destination setup: turn a bank or mobile money number into an opaque
 * Paystack recipient code, without ever storing the number.
 *
 * settlement_profiles established the rule that the full account number is
 * never persisted — only bank, last 4, and a constraint forbidding sensitive
 * keys in metadata. Transfers need that number, so it is treated as a
 * write-only credential: collected, exchanged with Paystack for a
 * recipient_code, and dropped. Everything downstream works from the code alone.
 */

/**
 * Fingerprints a destination request so a retry cannot mint a second recipient.
 *
 * HMAC rather than a bare hash. The prior art (paymentRequestFingerprint in
 * src/lib/payments/subaccounts.ts) SHA-256s the raw account number, and a
 * 10-digit account inside a known bank is a ~10^10 keyspace — a leaked digest
 * is brute-forced in seconds on any laptop. Keyed hashing makes the digest
 * useless without the server secret.
 */
export function destinationFingerprint(input: {
  sellerAccountId: string;
  bankCode: string;
  accountNumber: string;
  currency: string;
}): string {
  const secret = process.env.PAYOUT_FINGERPRINT_SECRET ?? process.env.INTERNAL_JOB_SECRET;
  if (!secret) {
    throw new Error("PAYOUT_FINGERPRINT_SECRET is not configured.");
  }
  return createHmac("sha256", secret)
    .update(
      [
        "paystack",
        input.sellerAccountId,
        input.currency,
        input.bankCode.trim(),
        input.accountNumber.trim(),
      ].join(""),
    )
    .digest("hex");
}

export type DestinationType = "bank" | "mobile_money";

export type DestinationInput = {
  sellerAccountId: string;
  currency: string;
  type: DestinationType;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
};

export type DestinationResult =
  | { status: "active"; destinationId: string; accountName: string | null }
  | { status: "error"; message: string };

/** Digits only, 6-20, matching what the settlement profile already accepts. */
export function isValidAccountNumber(value: string): boolean {
  return /^[0-9]{6,20}$/.test(value.trim());
}

export function accountLast4(value: string): string {
  return value.trim().slice(-4);
}

/**
 * Compares two fingerprints without leaking timing, for callers that check
 * whether a submitted destination matches the active one.
 */
export function fingerprintsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export type DestinationProvider = {
  resolveAccount(input: { accountNumber: string; bankCode: string }): Promise<{ accountName: string }>;
  createTransferRecipient(input: {
    type: DestinationType;
    name: string;
    accountNumber: string;
    bankCode: string;
    currency: string;
  }): Promise<{ recipientCode: string; accountName: string | null }>;
};

export type DestinationRepository = {
  reserve(input: {
    sellerAccountId: string;
    currency: string;
    type: DestinationType;
    bankCode: string;
    bankName: string;
    accountLast4: string;
    fingerprint: string;
  }): Promise<{ destinationId: string; status: string }>;
  activate(input: {
    destinationId: string;
    recipientCode: string;
    resolvedAccountName: string | null;
  }): Promise<void>;
};

/**
 * Reserve → provider call → activate, the same three phases the subaccount flow
 * uses, so a crash between the Paystack call and the database write leaves a
 * recoverable 'pending' row rather than an orphaned recipient. The fingerprint
 * makes the reserve idempotent, so a retry resumes instead of duplicating.
 */
export async function createPayoutDestination(
  input: DestinationInput,
  deps: { provider: DestinationProvider; repository: DestinationRepository },
): Promise<DestinationResult> {
  if (!isValidAccountNumber(input.accountNumber)) {
    return { status: "error", message: "Enter a valid account or mobile money number." };
  }
  if (!input.bankCode.trim() || !input.bankName.trim()) {
    return { status: "error", message: "Choose where the money should go." };
  }

  const fingerprint = destinationFingerprint({
    sellerAccountId: input.sellerAccountId,
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
    currency: input.currency,
  });

  let reserved;
  try {
    reserved = await deps.repository.reserve({
      sellerAccountId: input.sellerAccountId,
      currency: input.currency,
      type: input.type,
      bankCode: input.bankCode,
      bankName: input.bankName,
      accountLast4: accountLast4(input.accountNumber),
      fingerprint,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not save these details.",
    };
  }

  if (reserved.status === "active") {
    return { status: "active", destinationId: reserved.destinationId, accountName: null };
  }

  let recipientCode: string;
  let accountName: string | null;
  try {
    const created = await deps.provider.createTransferRecipient({
      type: input.type,
      name: input.accountName,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      currency: input.currency,
    });
    recipientCode = created.recipientCode;
    accountName = created.accountName;
  } catch (error) {
    // The reserved row stays 'pending' and its fingerprint is unchanged, so
    // resubmitting the same details resumes rather than creating a duplicate.
    return {
      status: "error",
      message:
        error instanceof Error
          ? `Your bank details were not accepted: ${error.message}`
          : "Your bank details were not accepted.",
    };
  }

  await deps.repository.activate({
    destinationId: reserved.destinationId,
    recipientCode,
    resolvedAccountName: accountName,
  });

  return { status: "active", destinationId: reserved.destinationId, accountName };
}
