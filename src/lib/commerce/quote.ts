export type QuoteLine = { productId: string; quantity: number };
export type PricedProduct = {
  productId: string;
  priceMinor: number;
  available: boolean;
};

export function calculateQuote(
  lines: QuoteLine[],
  products: PricedProduct[],
  deliveryMinor: number,
) {
  let subtotalMinor = 0;
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Invalid quantity.");
    }
    const product = products.find((item) => item.productId === line.productId);
    if (!product?.available) throw new Error("Product is unavailable.");
    subtotalMinor += product.priceMinor * line.quantity;
  }
  return {
    subtotalMinor,
    deliveryMinor,
    totalMinor: subtotalMinor + deliveryMinor,
  };
}
