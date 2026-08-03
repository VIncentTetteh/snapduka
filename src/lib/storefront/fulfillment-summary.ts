/**
 * How a shop gets orders to buyers, in three words or fewer.
 *
 * The storefront header hardcoded "Delivers nationwide" for every shop. Nothing
 * in the schema supports that claim — `fulfillment_methods`
 * (202606120005_fulfillment_checkout.sql) records only `type`, `name` and a fee.
 * There is no service area, no geography, no "nationwide" anywhere in the
 * database. A pickup-only stall in Kumasi was telling buyers it delivered
 * across Ghana.
 *
 * So this says only what the rows actually support, and says nothing when there
 * is nothing to say — a shop that has not configured fulfillment yet gets no
 * claim at all rather than a default one.
 */
export type FulfillmentType = { type: string | null; active?: boolean | null };

export function fulfillmentSummary(methods: FulfillmentType[] | null | undefined): string | null {
  if (!methods?.length) return null;

  const active = methods.filter((method) => method.active !== false);
  const delivers = active.some((method) => method.type === "delivery");
  const collects = active.some((method) => method.type === "pickup");

  if (delivers && collects) return "Delivery & pickup";
  if (delivers) return "Delivery";
  if (collects) return "Pickup only";
  return null;
}
