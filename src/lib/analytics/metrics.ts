export function calculateCommerceMetrics(input: {
  visits: number;
  productViews: number;
  checkoutStarts: number;
  orders: Array<{ status: string; paymentStatus: string; fulfillmentStatus: string }>;
}) {
  const completedOrders = input.orders.filter((order) => order.status === "completed").length;
  const paid = input.orders.filter((order) => order.paymentStatus === "paid").length;
  const fulfilled = input.orders.filter((order) => order.fulfillmentStatus === "fulfilled").length;
  const placedOrders = input.orders.length;
  return {
    visits: input.visits,
    productViews: input.productViews,
    checkoutStarts: input.checkoutStarts,
    placedOrders,
    completedOrders,
    conversionRate: input.visits ? completedOrders / input.visits : 0,
    paymentSuccessRate: placedOrders ? paid / placedOrders : 0,
    fulfillmentCompletionRate: placedOrders ? fulfilled / placedOrders : 0,
  };
}
