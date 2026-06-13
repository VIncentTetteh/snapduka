export function canDeliverMarketing(input: { consent: "granted" | "withdrawn"; sentLast30Days: number; cap: number }) {
  return input.consent === "granted" && input.sentLast30Days < input.cap;
}
