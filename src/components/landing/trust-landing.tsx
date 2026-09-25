import Link from "next/link";

import { formatMoney, protectFeeMinor } from "@snapduka/core";

import type { LandingData } from "@/lib/landing/data";

import { ProtectChat } from "./protect-chat";
import { TESTIMONIALS } from "./testimonials";

/**
 * The trust-led landing page: SnapDuka as the way a stranger can safely pay a
 * social seller up front. Shown per market with the `new_homepage` flag, which
 * is switched on together with Protect — every claim here is true only where
 * that is live, and the feature section lists only what is switched on for the
 * visitor's market (features in LandingData).
 *
 * Server component with no client JavaScript, like the classic page: the menu
 * is a native <details>, which works under the strict CSP.
 */

const COUNTRY_NAME = { GH: "Ghana", NG: "Nigeria", CI: "Côte d’Ivoire" } as const;

function percent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-ink no-underline">
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-[9px] bg-accent font-serif text-[17px] font-bold text-white">
        S
      </span>
      <span className="text-[17px] font-bold tracking-[-0.02em]">SnapDuka</span>
    </Link>
  );
}

function Header() {
  const links = [
    { label: "How Protect works", href: "#protect" },
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" },
  ];
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-5 py-3.5">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="text-[14px] font-medium text-ink-soft hover:text-ink">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className="text-[14px] font-medium text-ink-soft hover:text-ink">
            Log in
          </Link>
          <Link href="/onboarding" className="rounded-[10px] bg-ink px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-ink-2">
            Start selling free
          </Link>
        </div>
        <details className="md:hidden">
          <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-[14px] font-semibold text-ink">Menu</summary>
          <div className="absolute inset-x-0 top-full grid gap-1 border-b border-line bg-paper px-5 pb-4 pt-2">
            {links.map((link) => (
              <a key={link.href} href={link.href} className="rounded-lg px-3 py-3 text-base font-medium text-ink">
                {link.label}
              </a>
            ))}
            <Link href="/login" className="rounded-lg px-3 py-3 text-base font-medium text-ink">
              Log in
            </Link>
            <Link href="/onboarding" className="mt-1 rounded-[10px] bg-ink px-4 py-3 text-center text-base font-semibold text-white">
              Start selling free
            </Link>
          </div>
        </details>
      </div>
    </header>
  );
}

type Feature = { title: string; body: string };

function features(data: LandingData): Feature[] {
  const list: Feature[] = [];
  if (data.features.whatsappAssistant) {
    list.push({
      title: "Sell inside WhatsApp",
      body: "An assistant answers “how much?” and “do you have size 40?” from your real catalogue, quotes delivery and sends a checkout link — any hour. You take over whenever you want.",
    });
  }
  if (data.features.snapToList) {
    list.push({
      title: "Snap a photo, it’s listed",
      body: "Take a picture of the product and get a title, description and category to check. The suggested price comes from what similar items sell for in your market.",
    });
  }
  if (data.features.instantPayout) {
    list.push({
      title: "Withdraw to mobile money in minutes",
      body: `Standard withdrawals go out every morning. Need it now? Instant withdrawal is ${percent(data.fees.instantPayoutBps)} (minimum ${formatMoney(data.fees.instantPayoutMinMinor, data.currency)}).`,
    });
  }
  list.push({
    title: "One link for every channel",
    body: "Your storefront works in an Instagram bio, a TikTok caption, a WhatsApp status and a Snapchat story, with tracked links that show which post sold.",
  });
  return list;
}

export function TrustLanding({ data }: { data: LandingData }) {
  const sampleItem = data.currency === "NGN" ? 2400000 : data.currency === "XOF" ? 12000 : 24000;
  const policy = { feeBps: data.fees.protectBps, minMinor: data.fees.protectMinMinor, capMinor: data.fees.protectCapMinor };
  const sampleFee = protectFeeMinor(sampleItem, policy);
  const platform = percent(data.fees.platformBps);
  const inspectionHours = data.fees.inspectionHours;
  const autoDays = Math.round(data.fees.autoReleaseHours / 24);
  const featureList = features(data);

  return (
    <div className="min-h-svh bg-paper text-ink">
      <Header />
      <main className="sd-main">
        <section className="mx-auto grid max-w-[1120px] items-center gap-12 px-5 pb-16 pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:pb-24 lg:pt-20">
          <div>
            <h1 className="max-w-[16ch] font-serif text-[clamp(36px,5.2vw,60px)] font-medium leading-[1.04] tracking-[-0.02em]">
              Get paid before you ship — without scaring buyers away.
            </h1>
            <p className="mt-5 max-w-[52ch] text-[17px] leading-[1.6] text-ink-soft">
              SnapDuka Protect holds your buyer’s payment until their order arrives. Strangers pay you up front, you ship
              with confidence, and the money reaches your balance when they confirm delivery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/onboarding" className="rounded-[11px] bg-ink px-5 py-3.5 text-[15px] font-semibold text-white shadow-btn hover:bg-ink-2">
                Start selling free
              </Link>
              <Link href="/protect" className="rounded-[11px] border border-line-strong bg-white px-5 py-3.5 text-[15px] font-semibold text-ink hover:border-ink">
                How buyers are protected
              </Link>
            </div>
            <p className="mt-5 text-[13.5px] text-ink-muted">
              Free to start in {COUNTRY_NAME[data.country]}. We earn {platform} when you sell online — nothing on cash orders.
            </p>
          </div>
          <ProtectChat currency={data.currency} itemMinor={sampleItem} protectFeeMinor={sampleFee} />
        </section>

        <section aria-labelledby="problem-heading" className="border-y border-line bg-raised">
          <div className="mx-auto grid max-w-[1120px] gap-8 px-5 py-14 md:grid-cols-[0.8fr_1.2fr] md:items-start">
            <h2 id="problem-heading" className="font-serif text-[28px] font-medium leading-[1.15]">
              The screenshot, the transfer, the hoping for the best.
            </h2>
            <div className="grid gap-4 text-[16px] leading-[1.65] text-ink-soft">
              <p className="m-0">
                Buyers who have paid a stranger and been blocked ask for pay on delivery. So you pay the rider, and some
                orders are refused at the door.
              </p>
              <p className="m-0">
                Protect removes the reason to ask. The buyer’s money is safe until they have their order, and you know
                it is already paid before anything leaves your hands.
              </p>
            </div>
          </div>
        </section>

        <section id="protect" aria-labelledby="protect-heading" className="mx-auto max-w-[1120px] scroll-mt-20 px-5 py-16 lg:py-24">
          <h2 id="protect-heading" className="max-w-[22ch] font-serif text-[clamp(28px,3.4vw,40px)] font-medium leading-[1.1]">
            How a protected sale works
          </h2>
          <ol className="mt-10 grid list-none gap-8 p-0 md:grid-cols-4">
            {[
              { title: "The buyer pays with Protect", body: "By mobile money or card, at checkout. SnapDuka holds the payment." },
              { title: "You dispatch the order", body: "The buyer gets a six-digit delivery code by WhatsApp or SMS." },
              { title: "They hand the code to the rider", body: "Only once the order is in their hands — or they confirm it themselves." },
              {
                title: "You get paid",
                body: `After a ${inspectionHours}-hour window to report a problem, the money moves to your balance. No confirmation after ${autoDays} days? It confirms on its own.`,
              },
            ].map((step, index) => (
              <li key={step.title} className="border-t-2 border-accent pt-4">
                <p className="m-0 font-serif text-[15px] text-accent">{index + 1}</p>
                <h3 className="mt-1 text-[17px] font-semibold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-[1.6] text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 max-w-[70ch] text-[14.5px] leading-[1.6] text-ink-soft">
            The buyer pays a Protect fee of {percent(data.fees.protectBps)} (minimum{" "}
            {formatMoney(data.fees.protectMinMinor, data.currency)}, maximum{" "}
            {formatMoney(data.fees.protectCapMinor, data.currency)}). You pay nothing extra. If something goes wrong,
            SnapDuka reviews it and either releases the money to you or refunds the buyer.{" "}
            <Link href="/protect" className="font-semibold text-accent underline">
              Read how Protect works for buyers
            </Link>
          </p>
        </section>

        <section id="features" aria-labelledby="features-heading" className="scroll-mt-20 border-t border-line bg-white">
          <div className="mx-auto max-w-[1120px] px-5 py-16 lg:py-24">
            <h2 id="features-heading" className="font-serif text-[clamp(28px,3.4vw,40px)] font-medium leading-[1.1]">
              Built for how you already sell
            </h2>
            <dl className="mt-10 grid gap-x-12 gap-y-9 md:grid-cols-2">
              {featureList.map((feature) => (
                <div key={feature.title}>
                  <dt className="text-[18px] font-semibold">{feature.title}</dt>
                  <dd className="m-0 mt-2 max-w-[56ch] text-[15.5px] leading-[1.6] text-ink-soft">{feature.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {TESTIMONIALS.length > 0 ? (
          <section aria-labelledby="sellers-heading" className="border-t border-line bg-raised">
            <div className="mx-auto max-w-[1120px] px-5 py-16">
              <h2 id="sellers-heading" className="font-serif text-[28px] font-medium">
                From sellers using Protect
              </h2>
              <div className="mt-8 grid gap-8 md:grid-cols-2">
                {TESTIMONIALS.map((quote) => (
                  <figure key={quote.name} className="m-0">
                    <blockquote className="m-0 font-serif text-[20px] leading-[1.45]">“{quote.text}”</blockquote>
                    <figcaption className="mt-3 text-[14px] text-ink-soft">
                      {quote.name}, {quote.shop} — {quote.city}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section id="pricing" aria-labelledby="pricing-heading" className="mx-auto max-w-[1120px] scroll-mt-20 px-5 py-16 lg:py-24">
          <h2 id="pricing-heading" className="font-serif text-[clamp(28px,3.4vw,40px)] font-medium leading-[1.1]">
            Free to start. We earn when you sell.
          </h2>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-ink-soft">
            Every plan: {platform} on sales paid online, nothing on cash-on-delivery orders. Plans add tools as you grow.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {data.plans.map((plan) => (
              <div
                key={plan.code}
                className={`rounded-[18px] border p-6 ${plan.code === "growth" ? "border-ink bg-white" : "border-line bg-paper"}`}
              >
                <h3 className="text-[17px] font-semibold">{plan.name}</h3>
                <p className="mt-2 font-serif text-[28px]">
                  {plan.monthlyMinor === 0
                    ? "No monthly fee"
                    : plan.monthlyMinor === null
                      ? `Not yet in ${COUNTRY_NAME[data.country]}`
                      : `${formatMoney(plan.monthlyMinor, data.currency)} / month`}
                </p>
                <p className="mt-2 text-[14px] text-ink-soft">
                  {plan.code === "free"
                    ? `Storefront, checkout${data.features.protect ? ", Protect" : ""} and order management.`
                    : plan.code === "growth"
                      ? "Promotions, customer segments, delivery zones and analytics."
                      : "Team accounts, advanced analytics and priority support."}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="final-heading" className="mx-auto max-w-[1120px] px-5 pb-20">
          <div className="rounded-[24px] bg-ink px-6 py-12 text-center text-white md:px-12">
            <h2 id="final-heading" className="mx-auto max-w-[24ch] font-serif text-[clamp(26px,3.2vw,38px)] font-medium leading-[1.15]">
              Your next customer is ready to pay you up front.
            </h2>
            <Link href="/onboarding" className="mt-7 inline-block rounded-[11px] bg-white px-5 py-3.5 text-[15px] font-semibold text-ink hover:bg-raised">
              Start selling free
            </Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[14px] text-ink-soft">
          <Logo />
          <nav aria-label="Footer" className="flex flex-wrap gap-5">
            <Link href="/protect" className="hover:text-ink">SnapDuka Protect</Link>
            <Link href="/discover" className="hover:text-ink">Discover shops</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
          </nav>
          <p className="m-0 w-full text-[12.5px] text-ink-muted">© 2026 SnapDuka. Ghana, Nigeria and Côte d’Ivoire.</p>
        </div>
      </footer>
    </div>
  );
}
