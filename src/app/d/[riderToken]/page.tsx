import { notFound } from "next/navigation";

import { RiderCodeForm } from "@/components/storefront/rider-code-form";
import { protectionForRiderToken } from "@/lib/protect/service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Confirm delivery · SnapDuka",
  // A rider link is a capability for one delivery; never index it.
  robots: { index: false, follow: false },
};

/**
 * The courier's page for a SnapDuka Protect delivery. Opened from the rider
 * link the seller shares with whoever carries the parcel. It shows only what a
 * rider needs — the order reference and shop — never the buyer's details.
 */
export default async function RiderPage({ params }: { params: Promise<{ riderToken: string }> }) {
  const { riderToken } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(riderToken)) notFound();
  const found = await protectionForRiderToken(riderToken);
  if (!found) notFound();

  const { view, reference, shopName } = found;
  const open = view.state === "in_transit";

  return (
    <main className="sd-main min-h-svh bg-paper text-ink">
      <div className="mx-auto max-w-[420px] px-4 pb-16 pt-8">
        <div className="rounded-2xl border border-line bg-white px-5 py-6">
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-accent">SnapDuka Protect</p>
          <h1 className="mb-1 font-serif text-[22px] font-medium">Confirm delivery</h1>
          <p className="mb-5 text-[13.5px] text-ink-soft">
            Order <strong className="text-ink">{reference}</strong>
            {shopName ? ` · ${shopName}` : ""}
          </p>
          {open ? (
            <>
              <p className="mb-4 text-[13px] leading-[1.55] text-ink-soft">
                Hand over the parcel, then ask the buyer for the 6-digit code SnapDuka sent them.
              </p>
              <RiderCodeForm riderToken={riderToken} />
            </>
          ) : (
            <p className="text-[13.5px] text-ink-soft">
              {view.state === "releasable" || view.state === "released"
                ? "This delivery is already confirmed. Thank you!"
                : "This order is not out for delivery right now."}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
