import type { Metadata } from "next";
import Link from "next/link";

import { BrandLink } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "Privacy | SnapDuka",
};

export default function PrivacyPage() {
  return (
    <main className="sd-main min-h-screen bg-paper text-ink">
      <header className="border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[760px] items-center justify-between px-5">
          <BrandLink />
          <Link href="/" className="text-sm font-semibold text-ink-soft hover:text-ink">
            Back to home
          </Link>
        </div>
      </header>
      <article className="mx-auto max-w-[760px] px-5 pb-24 pt-12">
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Legal</p>
        <h1 className="mb-8 font-serif text-[clamp(30px,4.2vw,44px)] font-medium leading-[1.12] tracking-[-0.015em]">
          Privacy notice
        </h1>
        <div className="grid gap-5 text-[15.5px] leading-[1.7] text-ink-2">
          <p>
            SnapDuka processes seller account details, storefront information, buyer order details, payment
            references, fulfillment updates, and consent records to operate social-commerce storefronts.
          </p>
          <h2 className="mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">How information is used</h2>
          <p>
            Information is used to create and fulfill orders, provide receipts and support, prevent fraud, operate
            seller tools, and send marketing only when the buyer has given the required consent.
          </p>
          <h2 className="mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">Sharing and retention</h2>
          <p>
            Payment details are handled by configured payment providers. Order information is available only to the
            relevant seller, authorized team members, and SnapDuka operators who need it for support or risk review.
            Records are retained only as required for commerce, security, and legal obligations.
          </p>
          <h2 className="mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">Your choices</h2>
          <p>
            Buyers can withdraw marketing consent and request support through their secure order-tracking page.
            Sellers can manage notification and discovery preferences from the dashboard.
          </p>
          <p className="mt-4 rounded-xl border border-line bg-raised px-4 py-3.5 text-[13.5px] text-ink-muted">
            This launch notice must be reviewed against applicable Ghanaian, Nigerian and Ivorian privacy
            requirements before production publication.
          </p>
        </div>
      </article>
    </main>
  );
}
