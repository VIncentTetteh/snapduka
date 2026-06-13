export type ReconciliationState = "matched" | "missing" | "amount_mismatch";
export function classifySettlement(input: { expectedMinor: number; receivedMinor: number | null }): ReconciliationState {
  if (input.receivedMinor == null) return "missing";
  return input.expectedMinor === input.receivedMinor ? "matched" : "amount_mismatch";
}
