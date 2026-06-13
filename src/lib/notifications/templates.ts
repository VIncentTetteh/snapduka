export function orderUpdateTemplate(input: { reference: string; status: string; trackingUrl: string }) {
  return {
    subject: `Order ${input.reference}: ${input.status}`,
    text: `Your SnapDuka order is ${input.status}. Track it: ${input.trackingUrl}`,
  };
}
