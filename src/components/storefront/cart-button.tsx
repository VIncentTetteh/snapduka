"use client";

import Link from "next/link";

import { useCart } from "@/components/storefront/cart-provider";

export function CartButton({ slug }: { slug: string }) {
  const cart = useCart();
  const label = `Cart, ${cart.count} ${cart.count === 1 ? "item" : "items"}`;
  return (
    <Link
      href={cart.count > 0 ? cart.checkoutHref : `/${slug}`}
      aria-label={label}
      className="relative flex h-10 items-center gap-2 rounded-[10px] border border-line-input bg-white px-3 text-[13px] font-bold text-ink no-underline transition-colors hover:bg-line-soft"
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M4 5h12l-1 9.5H5L4 5Zm0 0-.5-2H2m6 13.5a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Zm7 0a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {cart.ready ? cart.count : "…"}
    </Link>
  );
}
