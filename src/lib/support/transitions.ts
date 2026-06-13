export type CaseState = "opened" | "seller_response_due" | "under_review" | "resolved" | "closed";
const transitions: Record<CaseState, CaseState[]> = {
  opened: ["seller_response_due","under_review","closed"],
  seller_response_due: ["under_review","resolved"],
  under_review: ["resolved"],
  resolved: ["closed"],
  closed: [],
};
export function canTransitionCase(from: CaseState, to: CaseState) {
  return transitions[from].includes(to);
}
