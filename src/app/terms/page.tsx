import type { Metadata } from "next";
import Link from "next/link";

import { BrandLink } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "Terms | SnapDuka",
};

export default function TermsPage() {
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
          Terms of service
        </h1>
        <div className="grid gap-5 text-[15.5px] leading-[1.7] text-ink-2">
          <p>
            SnapDuka provides storefront, checkout, order, fulfillment, and support tools for independent sellers.
            Each seller remains responsible for the products they list, their descriptions, pricing, delivery
            promises, returns, and compliance obligations.
          </p>
          <h2 className="mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">Orders and payments</h2>
          <p>
            Buyers should review the full price, delivery option, and payment state before confirming an order.
            Online payments are processed by the configured provider; offline payments remain due until the seller
            records receipt.
          </p>
          <h2 className="mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">Acceptable use</h2>
          <p>
            Users must not sell prohibited or unlawful goods, misrepresent products or verification, interfere with
            platform security, or access another seller&apos;s information.
          </p>
          <h2 className="mt-3 font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">Disputes and restrictions</h2>
          <p>
            Buyers and sellers can use the structured support process attached to an order. SnapDuka may restrict
            accounts or payments when necessary to investigate fraud, protect users, or comply with law.
          </p>
          <p className="mt-4 rounded-xl border border-line bg-raised px-4 py-3.5 text-[13.5px] text-ink-muted">
            These launch terms require final legal review and country-specific policy attachments before production
            publication.
          </p>
        </div>
      </article>
    </main>
  );
}
