/**
 * Seller quotes for the trust-led landing page. Deliberately empty: the
 * section only renders once there are real quotes from pilot sellers, given
 * with their permission. Never add invented or composite testimonials.
 */
export type Testimonial = {
  text: string;
  name: string;
  shop: string;
  city: string;
};

export const TESTIMONIALS: readonly Testimonial[] = [];
