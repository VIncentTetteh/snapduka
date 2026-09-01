"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useCart } from "./cart-provider";

/**
 * Checkout resolves its lines from the URL, so arriving at /checkout without
 * them — a bookmark, a pasted link, or back/forward navigation — renders the
 * empty state even while the header badge still counts a saved cart. Recover
 * the saved cart first, which is what the empty-state copy promises.
 *
 * `urlCarriedCart` is what keeps this from looping: once a redirect happens the
 * URL always carries the cart, so a saved cart the server rejects (stale or
 * corrupted entries that fail its UUID checks) falls through to the empty state
 * instead of bouncing forever.
 */
export function CheckoutCartRecovery({
  children,
  urlCarriedCart,
}: {
  children: ReactNode;
  urlCarriedCart: boolean;
}) {
  const { checkoutHref, lines, ready } = useCart();
  const router = useRouter();
  const recovering = ready && !urlCarriedCart && lines.length > 0;

  useEffect(() => {
    if (recovering) router.replace(checkoutHref);
  }, [checkoutHref, recovering, router]);

  if (recovering || (!ready && !urlCarriedCart)) {
    return (
      <div
        className="rounded-2xl border border-dashed border-line-strong bg-white px-6 py-11 text-center"
        role="status"
      >
        <p className="m-0 text-[13.5px] text-ink-soft">Restoring your cart…</p>
      </div>
    );
  }

  return <>{children}</>;
}
