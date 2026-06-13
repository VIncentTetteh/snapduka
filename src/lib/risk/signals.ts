export function assessRisk(input: { disputeRate: number; refundRate: number; paymentFailures: number }) {
  const score = (input.disputeRate >= 0.02 ? 2 : 0) + (input.refundRate >= 0.08 ? 2 : 0) + (input.paymentFailures >= 5 ? 1 : 0);
  return { score, action: score >= 3 ? "review" as const : "monitor" as const };
}
