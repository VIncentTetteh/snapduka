import type { ReactNode } from "react";

import { CartProvider } from "@/components/storefront/cart-provider";

export default async function StorefrontLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CartProvider shopSlug={slug}>{children}</CartProvider>;
}
