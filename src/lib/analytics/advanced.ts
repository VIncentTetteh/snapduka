export function advancedCommerceMetrics(input: { visits: number; checkouts: number; orders: { customerId: string; totalMinor: number }[] }) {
  const counts = new Map<string, number>();
  for (const order of input.orders) counts.set(order.customerId, (counts.get(order.customerId) ?? 0) + 1);
  const repeat = [...counts.values()].filter((count) => count > 1).length;
  return {
    checkoutRate: input.visits ? input.checkouts / input.visits : 0,
    orderRate: input.visits ? input.orders.length / input.visits : 0,
    averageOrderMinor: input.orders.length ? Math.round(input.orders.reduce((sum, order) => sum + order.totalMinor, 0) / input.orders.length) : 0,
    repeatBuyerRate: counts.size ? repeat / counts.size : 0,
  };
}

export type ProductProfitInput = {
  productId: string;
  productName: string;
  quantity: number;
  lineTotalMinor: number;
  unitCostMinor: number | null;
};

export type ProductProfitSummary = {
  productId: string;
  productName: string;
  unitsSold: number;
  revenueMinor: number;
  costMinor: number | null;
  profitMinor: number | null;
};

export function productProfitSummaries(lines: ProductProfitInput[]): ProductProfitSummary[] {
  const byProduct = new Map<string, { productName: string; unitsSold: number; revenueMinor: number; costMinor: number; costUnknown: boolean }>();

  for (const line of lines) {
    const entry = byProduct.get(line.productId) ?? {
      productName: line.productName,
      unitsSold: 0,
      revenueMinor: 0,
      costMinor: 0,
      costUnknown: false,
    };
    entry.unitsSold += line.quantity;
    entry.revenueMinor += line.lineTotalMinor;
    if (line.unitCostMinor === null) {
      entry.costUnknown = true;
    } else if (!entry.costUnknown) {
      entry.costMinor += line.unitCostMinor * line.quantity;
    }
    byProduct.set(line.productId, entry);
  }

  return [...byProduct.entries()].map(([productId, entry]) => ({
    productId,
    productName: entry.productName,
    unitsSold: entry.unitsSold,
    revenueMinor: entry.revenueMinor,
    costMinor: entry.costUnknown ? null : entry.costMinor,
    profitMinor: entry.costUnknown ? null : entry.revenueMinor - entry.costMinor,
  }));
}
