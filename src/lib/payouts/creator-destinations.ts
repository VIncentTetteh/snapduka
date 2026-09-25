import "server-only";

import type { CurrencyCode } from "@snapduka/core";

import {
  createPayoutDestination,
  isValidAccountNumber,
  type DestinationProvider,
  type DestinationResult,
  type DestinationType,
} from "./destinations";

/**
 * Where a creator's withdrawals go.
 *
 * The same reserve -> Paystack -> activate flow a seller uses
 * (createPayoutDestination), so the account number is still a write-only
 * credential exchanged for a recipient code and never stored. Two differences:
 *
 *  - The account holder's name is resolved with Paystack FIRST and used as the
 *    recipient name. A seller's recipient is named after their registered shop;
 *    a creator has no legal entity on file, so the bank's own answer to "whose
 *    account is this" is the best name there is — and a number that does not
 *    resolve is refused before anything is reserved.
 *  - The fingerprint subject is `creator:<id>`, never a bare id, so a creator
 *    and a seller can never produce the same fingerprint (and so never resume
 *    each other's pending destination), whatever their ids.
 */

export function creatorDestinationSubject(creatorId: string): string {
  return `creator:${creatorId}`;
}

export type CreatorDestinationInput = {
  creatorId: string;
  currency: CurrencyCode;
  type: DestinationType;
  bankCode: string;
  bankName: string;
  accountNumber: string;
};

export type CreatorDestinationRepository = {
  reserve(input: {
    creatorId: string;
    currency: CurrencyCode;
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

export async function createCreatorPayoutDestination(
  input: CreatorDestinationInput,
  deps: { provider: DestinationProvider; repository: CreatorDestinationRepository },
): Promise<DestinationResult> {
  // Checked here as well as in createPayoutDestination so a malformed number
  // never reaches Paystack's resolve endpoint either.
  if (!isValidAccountNumber(input.accountNumber)) {
    return { status: "error", message: "Enter a valid account or mobile money number." };
  }
  if (!input.bankCode.trim() || !input.bankName.trim()) {
    return { status: "error", message: "Choose where the money should go." };
  }

  let accountName: string;
  try {
    const resolved = await deps.provider.resolveAccount({
      accountNumber: input.accountNumber.trim(),
      bankCode: input.bankCode.trim(),
    });
    accountName = resolved.accountName.trim();
  } catch {
    // Deliberately not the provider's message: it can echo the number back.
    return {
      status: "error",
      message: "We could not confirm that account. Check the number and the bank or network.",
    };
  }
  if (!accountName) {
    return { status: "error", message: "We could not confirm who owns that account." };
  }

  return createPayoutDestination(
    {
      sellerAccountId: creatorDestinationSubject(input.creatorId),
      currency: input.currency,
      type: input.type,
      bankCode: input.bankCode,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountName,
    },
    {
      provider: deps.provider,
      repository: {
        reserve: (reserved) =>
          deps.repository.reserve({
            creatorId: input.creatorId,
            currency: input.currency,
            type: reserved.type,
            bankCode: reserved.bankCode,
            bankName: reserved.bankName,
            accountLast4: reserved.accountLast4,
            fingerprint: reserved.fingerprint,
          }),
        // Paystack's name from the resolve step wins over whatever the
        // recipient call returns, which for mobile money is often empty.
        activate: (activated) =>
          deps.repository.activate({
            ...activated,
            resolvedAccountName: activated.resolvedAccountName ?? accountName,
          }),
      },
    },
  ).then((result) =>
    result.status === "active" ? { ...result, accountName: result.accountName ?? accountName } : result,
  );
}
