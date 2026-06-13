export type InitializePaymentInput = {
  email: string;
  amountMinor: number;
  currency: "GHS" | "NGN";
  reference: string;
  subaccount: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
};

export interface PaymentProvider {
  initialize(input: InitializePaymentInput): Promise<{ authorizationUrl: string; accessCode: string; reference: string }>;
  verify(reference: string): Promise<{ status: string; amountMinor: number; currency: string; reference: string }>;
  refund(input: { reference: string; amountMinor?: number }): Promise<{ providerId: string; status: string }>;
}
