import { createClient } from "@/lib/supabase/server";

export type AnalyticsSummary = {
  visits: number;
  productViews: number;
  checkoutStarts: number;
  ordersPlaced: number;
  paidOrders: number;
  paidTotalMinor: number;
  distinctBuyers: number;
  repeatBuyers: number;
};

/** Every event this app has ever recorded; the dashboards report all time. */
const EPOCH = "1970-01-01T00:00:00Z";

/**
 * A seller's funnel and order totals, aggregated in Postgres.
 *
 * seller_analytics_summary (migration 202608070069) was built for the mobile
 * app and the web dashboards never adopted it, so they counted events with
 * three separate head queries and then pulled every order row to count the paid
 * ones. That order query has no bound, which is the same PostgREST db.max_rows
 * trap that was already making the event counts wrong — it just had not been
 * noticed yet.
 *
 * One round trip now, correct past any row count, and it supersedes
 * fetchEventCounts for callers that also need order totals.
 *
 * SECURITY INVOKER, so RLS scopes it to the caller and it takes no account id.
 */
export async function fetchAnalyticsSummary(
  from: string = EPOCH,
  to: string = new Date().toISOString(),
): Promise<AnalyticsSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_analytics_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) {
    console.error("[fetchAnalyticsSummary] seller_analytics_summary failed", error);
    throw error;
  }

  // Every column is bigint, which PostgREST may serialize as a string; Number()
  // keeps the rate arithmetic from concatenating.
  const row = data?.[0];
  return {
    visits: Number(row?.visits ?? 0),
    productViews: Number(row?.product_views ?? 0),
    checkoutStarts: Number(row?.checkout_starts ?? 0),
    ordersPlaced: Number(row?.orders_placed ?? 0),
    paidOrders: Number(row?.paid_orders ?? 0),
    paidTotalMinor: Number(row?.paid_total_minor ?? 0),
    distinctBuyers: Number(row?.distinct_buyers ?? 0),
    repeatBuyers: Number(row?.repeat_buyers ?? 0),
  };
}
