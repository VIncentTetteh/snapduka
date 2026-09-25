import type { CurrencyCode } from "@snapduka/core";

/**
 * Shapes the admin overview's SQL aggregates (admin_order_totals_since and
 * admin_pending_payout_totals, migration 202609250240) into tile values.
 *
 * Only ever a handful of rows — one per currency — so combining them here is
 * safe; the per-order work happens in SQL. Money is never added across
 * currencies: GHS and NGN minor units are not the same unit, and the old
 * pending-payout total did exactly that.
 */

/** Row of admin_order_totals_since. bigint columns may arrive as strings. */
export type OrderTotalsRow = {
  currency: string;
  orders: number | string;
  paid_orders: number | string;
  gmv_minor: number | string;
};

/** Row of admin_pending_payout_totals. */
export type PendingPayoutRow = {
  currency: string;
  requests: number | string;
  amount_minor: number | string;
};

export type OverviewMetrics = {
  gmvByCurrency: Record<string, number>;
  /** Currencies that took paid GMV in the window, largest first. */
  markets: string[];
  primaryCurrency: CurrencyCode;
  orders30d: number;
  paidShare: number;
  pendingPayoutCount: number;
  /** Pending money in the currency with the most of it; see pendingPayoutCurrency. */
  pendingPayoutTotal: number;
  pendingPayoutCurrency: CurrencyCode;
};

const DEFAULT_CURRENCY: CurrencyCode = "GHS";

export function summariseOverview(
  orderTotals: readonly OrderTotalsRow[],
  pendingTotals: readonly PendingPayoutRow[],
): OverviewMetrics {
  const gmvByCurrency: Record<string, number> = {};
  let orders30d = 0;
  let paidCount = 0;
  for (const row of orderTotals) {
    orders30d += Number(row.orders);
    paidCount += Number(row.paid_orders);
    const gmv = Number(row.gmv_minor);
    if (gmv > 0) gmvByCurrency[row.currency] = gmv;
  }
  const markets = Object.keys(gmvByCurrency).sort((a, b) => gmvByCurrency[b] - gmvByCurrency[a]);
  const primaryCurrency = (markets[0] ?? DEFAULT_CURRENCY) as CurrencyCode;
  const paidShare = orders30d > 0 ? Math.round((paidCount / orders30d) * 100) : 0;

  let pendingPayoutCount = 0;
  let largest: PendingPayoutRow | null = null;
  for (const row of pendingTotals) {
    pendingPayoutCount += Number(row.requests);
    if (!largest || Number(row.amount_minor) > Number(largest.amount_minor)) largest = row;
  }

  return {
    gmvByCurrency,
    markets,
    primaryCurrency,
    orders30d,
    paidShare,
    pendingPayoutCount,
    pendingPayoutTotal: largest ? Number(largest.amount_minor) : 0,
    pendingPayoutCurrency: (largest?.currency ?? primaryCurrency) as CurrencyCode,
  };
}
