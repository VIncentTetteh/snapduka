import type { ToolBackend, ToolProduct } from "./tools";

/**
 * A small fixture shop for tests and the offline eval harness. Ids are fixed
 * UUIDs so tool-input validation (which requires UUIDs) behaves as in production.
 */
export const FIXTURE_PRODUCTS: ToolProduct[] = [
  {
    id: "0f000000-0000-4000-8000-000000000001",
    name: "Black leather sneakers",
    priceMinor: 45000,
    compareAtPriceMinor: null,
    currency: "GHS",
    price: "GH₵450.00",
    inStock: true,
    variants: [
      { id: "0f000000-0000-4000-8000-0000000000a1", name: "Size 42", price: "GH₵450.00", inStock: true },
      { id: "0f000000-0000-4000-8000-0000000000a2", name: "Size 44", price: "GH₵450.00", inStock: false },
    ],
  },
  {
    id: "0f000000-0000-4000-8000-000000000002",
    name: "Raw shea butter 500g",
    priceMinor: 6000,
    compareAtPriceMinor: 7500,
    currency: "GHS",
    price: "GH₵60.00",
    inStock: true,
  },
];

export function fixtureBackend(overrides: Partial<ToolBackend> = {}): ToolBackend {
  return {
    async searchCatalog(query) {
      const words = query.toLowerCase().split(/\s+/);
      return FIXTURE_PRODUCTS.filter((product) => words.some((word) => product.name.toLowerCase().includes(word)));
    },
    async getProduct(productId) {
      return FIXTURE_PRODUCTS.find((product) => product.id === productId) ?? null;
    },
    async checkStock(productId) {
      const product = FIXTURE_PRODUCTS.find((candidate) => candidate.id === productId);
      return product ? { available: product.inStock, quantity: product.inStock ? 3 : 0 } : null;
    },
    async quoteDelivery() {
      return { options: [{ label: "Accra delivery", fee: "GH₵35.00", type: "delivery" }] };
    },
    async createCheckoutLink(productId) {
      return FIXTURE_PRODUCTS.some((product) => product.id === productId)
        ? { url: `https://snapduka.test/l/wa-k7m2-${productId.slice(0, 8)}` }
        : null;
    },
    async getOrderStatus(reference) {
      return reference === "SD-PAID123456"
        ? {
            found: true,
            reference,
            status: "confirmed",
            fulfillment: "unconfirmed",
            payment: "paid",
            trackingUrl: "https://snapduka.test/orders/t",
          }
        : { found: false };
    },
    ...overrides,
  };
}
