import type { PaymentSubaccountResult } from "./subaccounts";

export type PaymentActionResult = {
  status: "success" | "processing" | "error";
  message: string;
};

export function mapPaymentActionResult(
  paymentResult: PaymentSubaccountResult,
): PaymentActionResult {
  if (paymentResult.status === "blocked") {
    const messages = {
      country: "Choose a supported seller country.",
      settlement: "Complete the shop identity and settlement details.",
      seller: "This seller account is not eligible for payment setup.",
      policy: "Accept the current seller policy before enabling online payments.",
      verification:
        "Settlement details saved. Seller verification must be verified before online payments can be enabled.",
      profile: "Save settlement details before enabling online payments.",
      shop: "Save the draft shop identity before enabling online payments.",
    };

    return {
      status: "success",
      message: messages[paymentResult.blocker],
    };
  }

  if (paymentResult.status === "in_progress") {
    return {
      status: "processing",
      message: "A payment account request is already processing.",
    };
  }

  if (paymentResult.status === "reconciliation_required") {
    return {
      status: "processing",
      message: paymentResult.message,
    };
  }

  if (paymentResult.status === "error") {
    return {
      status: "error",
      message:
        "Settlement details were saved, but payment activation is not available yet.",
    };
  }

  return {
    status: "success",
    message: "Online payment settlement is active.",
  };
}
