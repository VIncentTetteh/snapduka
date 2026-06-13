import { createHash } from "node:crypto";

export interface PaymentSubaccountProvider {
  create(input: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
    percentageCharge: number;
  }): Promise<{ providerId: string; subaccountCode: string }>;
}

export type PaymentSubaccountRequest = {
  authUserId: string;
  sellerAccountId: string;
  country: "GH" | "NG" | null;
  businessName: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  percentageCharge: number;
};

type ActiveSubaccount = {
  providerId: string;
  subaccountCode: string;
};

type ReservationResult =
  | { kind: "reserved"; reservationId: string }
  | { kind: "in_progress" }
  | {
      kind: "provider_created";
      reservationId: string;
      result: ActiveSubaccount & { metadata: SafeSettlementMetadata };
    }
  | {
      kind: "blocked";
      blocker: "seller" | "policy" | "verification" | "profile" | "shop";
    };

export interface PaymentSubaccountRepository {
  findActive(sellerAccountId: string): Promise<ActiveSubaccount | null>;
  reserve(input: {
    authUserId: string;
    sellerAccountId: string;
    fingerprint: string;
    metadata: SafeSettlementMetadata;
  }): Promise<ReservationResult>;
  recordProviderResult(input: {
    authUserId: string;
    sellerAccountId: string;
    reservationId: string;
    result: ActiveSubaccount & { metadata: SafeSettlementMetadata };
  }): Promise<void>;
  activate(input: {
    authUserId: string;
    sellerAccountId: string;
    reservationId: string;
  }): Promise<void>;
  release(reservationId: string): Promise<void>;
}

export type SafeSettlementMetadata = {
  bankCode: string;
  bankName: string;
  accountLast4: string;
  country: "GH" | "NG";
};

export type PaymentSubaccountResult =
  | ({
      status: "active";
      created: boolean;
    } & ActiveSubaccount)
  | { status: "in_progress" }
  | { status: "reconciliation_required"; message: string }
  | {
      status: "blocked";
      blocker:
        | "country"
        | "settlement"
        | "seller"
        | "policy"
        | "verification"
        | "profile"
        | "shop";
    }
  | { status: "error"; message: string };

function blocker(
  request: PaymentSubaccountRequest,
): PaymentSubaccountResult | null {
  if (!request.country) {
    return { status: "blocked", blocker: "country" };
  }

  if (
    !request.businessName.trim() ||
    !request.bankCode.trim() ||
    !request.bankName.trim() ||
    !/^[0-9]{6,20}$/.test(request.accountNumber)
  ) {
    return { status: "blocked", blocker: "settlement" };
  }

  return null;
}

export function paymentRequestFingerprint(
  request: PaymentSubaccountRequest,
): string {
  return createHash("sha256")
    .update(
      [
        "paystack",
        request.sellerAccountId,
        request.country ?? "",
        request.businessName.trim(),
        request.bankCode.trim(),
        request.accountNumber,
        String(request.percentageCharge),
      ].join("\u001f"),
    )
    .digest("hex");
}

export async function createPaymentSubaccount(
  request: PaymentSubaccountRequest,
  dependencies: {
    provider: PaymentSubaccountProvider;
    repository: PaymentSubaccountRepository;
  },
): Promise<PaymentSubaccountResult> {
  const blocked = blocker(request);

  if (blocked) {
    return blocked;
  }

  const country = request.country;

  if (!country) {
    return { status: "blocked", blocker: "country" };
  }

  const metadata: SafeSettlementMetadata = {
    bankCode: request.bankCode.trim(),
    bankName: request.bankName.trim(),
    accountLast4: request.accountNumber.slice(-4),
    country,
  };
  let reservationId: string | null = null;
  let providerCreated = false;

  try {
    const existing = await dependencies.repository.findActive(
      request.sellerAccountId,
    );

    if (existing) {
      return {
        status: "active",
        created: false,
        ...existing,
      };
    }

    const reservation = await dependencies.repository.reserve({
      authUserId: request.authUserId,
      sellerAccountId: request.sellerAccountId,
      fingerprint: paymentRequestFingerprint(request),
      metadata,
    });

    if (reservation.kind === "in_progress") {
      return { status: "in_progress" };
    }

    if (reservation.kind === "blocked") {
      return { status: "blocked", blocker: reservation.blocker };
    }

    reservationId = reservation.reservationId;
    const created =
      reservation.kind === "provider_created"
        ? reservation.result
        : await dependencies.provider.create({
            businessName: request.businessName.trim(),
            bankCode: request.bankCode.trim(),
            accountNumber: request.accountNumber,
            percentageCharge: request.percentageCharge,
          });
    providerCreated = true;

    if (reservation.kind === "reserved") {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await dependencies.repository.recordProviderResult({
            authUserId: request.authUserId,
            sellerAccountId: request.sellerAccountId,
            reservationId,
            result: {
              ...created,
              metadata,
            },
          });
          break;
        } catch {
          if (attempt === 3) {
            return {
              status: "reconciliation_required",
              message:
                "Payment setup is processing. It will be reconciled without creating another provider account.",
            };
          }
        }
      }
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await dependencies.repository.activate({
          authUserId: request.authUserId,
          sellerAccountId: request.sellerAccountId,
          reservationId,
        });
        break;
      } catch {
        if (attempt === 3) {
          return {
            status: "reconciliation_required",
            message:
              "Payment setup is processing. It will be reconciled without creating another provider account.",
          };
        }
      }
    }

    return {
      status: "active",
      created: reservation.kind === "reserved",
      providerId: created.providerId,
      subaccountCode: created.subaccountCode,
    };
  } catch {
    if (reservationId && !providerCreated) {
      try {
        await dependencies.repository.release(reservationId);
      } catch {
        // The caller receives a stable error even if cleanup also fails.
      }
    }

    return {
      status: "error",
      message: "We could not create the payment account. Please try again.",
    };
  }
}
