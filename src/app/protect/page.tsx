import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { formatMoney } from "@snapduka/core";

import { getLandingData, visitorCountry } from "@/lib/landing/data";

/**
 * What SnapDuka Protect means for a buyer. Buyers reach it from the Protect
 * panel on their order tracking page and from a shop's checkout, so it speaks
 * to them, not to sellers. Fees and time windows are read from the market's
 * live configuration, never written into the copy.
 *
 * Not indexed until Protect is live in the visitor's market: it is linked only
 * from protected orders until then, and search engines must not present a
 * promise that cannot yet be kept.
 */

// Per-visitor market, so never prerendered.
export const dynamic = "force-dynamic";

async function data() {
  return getLandingData(visitorCountry(await headers()));
}

export async function generateMetadata(): Promise<Metadata> {
  const live = (await data()).features.protect;
  return {
    title: "SnapDuka Protect — your payment is held until your order arrives",
    description: "How SnapDuka Protect keeps your money safe when you buy from a social seller.",
    robots: live ? undefined : { index: false, follow: false },
  };
}

export default async function ProtectPage() {
  const landing = await data();
  const { fees, currency } = landing;
  const percent = `${Number((fees.protectBps / 100).toFixed(2))}%`;
  const autoDays = Math.round(fees.autoReleaseHours / 24);

  const sections = [
    {
      title: "Your money is held, not sent",
      body: "When you pay with Protect, SnapDuka holds your payment. The seller can see that you have paid, but they cannot withdraw it yet.",
    },
    {
      title: "You get a delivery code",
      body: "When the seller sends your order, we send you a six-digit code by WhatsApp or SMS. You can also see a fresh code on your order tracking page at any time.",
    },
    {
      title: "Give the code only when you have your order",
      body: "The rider asks for the code at your door. Give it once the order is in your hands. If you collect it yourself, show the code to the seller then. Nobody from SnapDuka will ever ask you for it.",
    },
    {
      title: "Something wrong? Tell us before the seller is paid",
      body: `After delivery you have ${fees.inspectionHours} hours to report a problem from your tracking page. Your payment stays held while SnapDuka looks into it, and we either release it to the seller or refund you.`,
    },
    {
      title: "If you never confirm",
      body: `If the order is not confirmed and nothing is reported within ${autoDays} days of dispatch, delivery is confirmed automatically and the seller is paid. A courier’s own delivery report can shorten that wait.`,
    },
  ];

  return (
    <main className="sd-main min-h-svh bg-paper text-ink">
      <div className="mx-auto max-w-[720px] px-5 pb-20 pt-10">
        <Link href="/" className="text-[14px] font-semibold text-ink-soft no-underline hover:text-ink">
          SnapDuka
        </Link>
        <h1 className="mt-8 font-serif text-[clamp(32px,5vw,46px)] font-medium leading-[1.08]">
          Your payment is held until your order arrives.
        </h1>
        <p className="mt-4 text-[17px] leading-[1.6] text-ink-soft">
          SnapDuka Protect lets you pay a social seller up front without taking their word for it.
        </p>
        <ol className="mt-10 grid list-none gap-8 p-0">
          {sections.map((section, index) => (
            <li key={section.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span aria-hidden="true" className="font-serif text-[18px] text-accent">
                {index + 1}
              </span>
              <div>
                <h2 className="m-0 text-[18px] font-semibold">{section.title}</h2>
                <p className="mt-2 text-[15.5px] leading-[1.65] text-ink-soft">{section.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <section aria-labelledby="fee-heading" className="mt-12 rounded-[18px] border border-line bg-white p-6">
          <h2 id="fee-heading" className="m-0 text-[17px] font-semibold">
            What it costs
          </h2>
          <p className="mt-2 text-[15.5px] leading-[1.65] text-ink-soft">
            A Protect fee of {percent} of your order, at least {formatMoney(fees.protectMinMinor, currency)} and at most{" "}
            {formatMoney(fees.protectCapMinor, currency)}. It is shown at checkout before you pay, and you can choose to
            pay without Protect.
          </p>
        </section>
      </div>
    </main>
  );
}
