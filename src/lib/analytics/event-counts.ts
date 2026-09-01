import { analyticsEventTypes, type AnalyticsEventType } from "@/lib/analytics/events";
import { createClient } from "@/lib/supabase/server";

export type EventCounts = Record<AnalyticsEventType, number>;

/**
 * Counts analytics events in the database rather than in JavaScript.
 *
 * Three dashboards used to `select("event_type")` for a seller and count the
 * rows with `Array.filter`. PostgREST caps a response at `db.max_rows` (1000),
 * so past that the counts silently stopped growing — and the conversion rates
 * derived from them were wrong in both numerator and denominator. A seller only
 * has to be doing well for their numbers to start lying.
 *
 * Builds its own cookie-bound client so callers keep their own `supabase`
 * binding free: handing this function the caller's client made tsc compare the
 * client's generics structurally and blow its instantiation depth limit.
 */
export async function fetchEventCounts(sellerAccountId: string): Promise<EventCounts> {
  const supabase = await createClient();
  const results = await Promise.all(
    analyticsEventTypes.map(async (eventType) => {
      const { count } = await supabase
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", sellerAccountId)
        .eq("event_type", eventType);
      return [eventType, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(results) as EventCounts;
}
