export type InitializePaymentInput = {
  email: string;
  amountMinor: number;
  currency: "GHS" | "NGN";
  reference: string;
  /**
   * Legacy split payments only. Omitted under settlement_mode='ledger', where
   * the whole amount lands in SnapDuka's main account and the seller is
   * credited internally. Optional rather than removed so a rollback to the
   * subaccount flow still compiles.
   */
  subaccount?: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
};

export interface PaymentProvider {
  initialize(input: InitializePaymentInput): Promise<{ authorizationUrl: string; accessCode: string; reference: string }>;
  verify(reference: string): Promise<{
    status: string;
    amountMinor: number;
    currency: string;
    reference: string;
    authorizationCode: string | null;
    customerCode: string | null;
  }>;
  refund(input: { reference: string; amountMinor?: number }): Promise<{ providerId: string; status: string }>;
}
