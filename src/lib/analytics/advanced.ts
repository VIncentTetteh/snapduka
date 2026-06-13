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
