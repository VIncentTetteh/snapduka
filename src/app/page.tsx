import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "SnapDuka — Your social audience is ready to buy. Give them a checkout.",
  description:
    "Turn Instagram, TikTok, Snapchat and WhatsApp interest into organized, trackable orders with a storefront built for African social sellers. GHS, NGN and XOF. Paystack payments. Guest checkout.",
};

/* ---------------------------------------------------------------------------
 * SnapDuka public landing page.
 * Server component — no client-side JavaScript. The mobile menu uses a
 * native <details> disclosure so it works under a strict CSP with JS disabled.
 * Palette: warm off-white #FAF7F2 · charcoal #211B14 · terracotta #A8431A
 * accent · emerald #047857 reserved for verification/payment/success signals.
 * ------------------------------------------------------------------------- */

const ACCENT = "#A8431A";

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10m0 0L9 4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="9" cy="9" r="8.2" stroke="#C9BBA6" strokeWidth="1.2" />
      <path d="M5.6 9.3 8 11.6l4.4-5" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StrokeIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VerifiedBadge({ label = "Verified seller" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E7F4EE] px-2.5 py-1 text-[11px] font-semibold text-[#047857]">
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2.5 7.2 5.5 10l6-6.5" stroke="#047857" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </span>
  );
}

/* ----------------------------- data ------------------------------------- */

const NAV_LINKS = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

const TRUST_ITEMS = [
  "GHS, NGN and XOF",
  "Paystack payments",
  "Guest checkout",
  "Mobile-first storefronts",
  "Order tracking",
];

const PRODUCTS = [
  { name: "Two-piece linen set", price: "GHS 240", swatch: "linear-gradient(140deg,#E4D5BF,#A8875D)" },
  { name: "Woven tote bag", price: "GHS 185", swatch: "linear-gradient(140deg,#D8DDD2,#8B9683)" },
  { name: "Shea body butter", price: "GHS 320", swatch: "linear-gradient(140deg,#E7D9D2,#B08D7D)" },
  { name: "Beaded sandals", price: "GHS 150", swatch: "linear-gradient(140deg,#DCD8E0,#8E879B)" },
];

const STEPS = [
  {
    num: "01",
    title: "Add your products",
    body: "Photos, prices, variants and stock — set up your catalogue in minutes from your phone.",
    icon: "M4 6.5 10 3l6 3.5v7L10 17l-6-3.5v-7Zm0 0L10 10m0 0 6-3.5M10 10v7",
  },
  {
    num: "02",
    title: "Share your storefront",
    body: "One link for WhatsApp, Instagram, TikTok and Snapchat. Your bio, stories and statuses all point to the same place.",
    icon: "M13.5 6.5 6.8 9.6m0 .9 6.7 3M16 5a2.2 2.2 0 1 1-4.4 0A2.2 2.2 0 0 1 16 5ZM8.4 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Zm7.6 5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z",
  },
  {
    num: "03",
    title: "Receive and fulfil orders",
    body: "Every order arrives paid and tracked. Confirm, arrange delivery or pickup, and mark it fulfilled.",
    icon: "M4 5h12l-1 9.5H5L4 5Zm0 0-.5-2H2m6 13.5a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Zm7 0a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Z",
  },
];

const STOREFRONT_POINTS = [
  { lead: "Products and variants", rest: "sizes, colours and options presented clearly, with live stock." },
  { lead: "Persistent cart", rest: "customers can leave and come back without losing their order." },
  { lead: "Guest checkout", rest: "no account or app download required to buy." },
  { lead: "Local pricing and delivery", rest: "prices in GHS, NGN or XOF, with delivery and pickup options you define." },
];

const DASHBOARD_POINTS = [
  { lead: "Order and payment tracking", rest: "see what is paid, packed and delivered at a glance." },
  { lead: "Customer records and consent", rest: "a proper customer list, collected with permission." },
  { lead: "Delivery management", rest: "assign zones, fees and pickup points once — applied at checkout." },
  { lead: "Promotions and analytics", rest: "run campaigns and see which channels actually convert." },
];

const ORDERS = [
  { customer: "Efua Mensah", ref: "#1042", channel: "Instagram", amount: "GHS 450", status: "Paid", badge: "bg-[#E7F4EE] text-[#047857]", swatch: "linear-gradient(140deg,#E4D5BF,#A8875D)" },
  { customer: "Kwame Boateng", ref: "#1041", channel: "WhatsApp", amount: "GHS 185", status: "Delivering", badge: "bg-[#F1EAE0] text-[#6B4F35]", swatch: "linear-gradient(140deg,#D8DDD2,#8B9683)" },
  { customer: "Adjoa Owusu", ref: "#1040", channel: "TikTok", amount: "GHS 320", status: "Paid", badge: "bg-[#E7F4EE] text-[#047857]", swatch: "linear-gradient(140deg,#E7D9D2,#B08D7D)" },
  { customer: "Yaw Darko", ref: "#1039", channel: "Snapchat", amount: "GHS 240", status: "Fulfilled", badge: "bg-[#EDEBE7] text-[#57504A]", swatch: "linear-gradient(140deg,#DCD8E0,#8E879B)" },
];

const REGIONAL_ITEMS = [
  {
    title: "Three markets, three currencies",
    body: "Sell in GHS, NGN or XOF depending on where you and your customers are — Ghana, Nigeria or Côte d’Ivoire.",
    icon: "M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm-7 5h14m-14 5h14M10 2.5c-4.5 4.5-4.5 10.5 0 15m0-15c4.5 4.5 4.5 10.5 0 15",
  },
  {
    title: "Mobile-first buying",
    body: "Storefronts are built for the phones your customers actually shop on, over the connections they actually have.",
    icon: "M6.5 2.5h7A1.5 1.5 0 0 1 15 4v12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V4a1.5 1.5 0 0 1 1.5-1.5Zm2 12.5h3",
  },
  {
    title: "Flexible delivery and pickup",
    body: "Riders, pickup points, market-day handoffs — define the delivery options that match how you already work.",
    icon: "M2.5 5.5h9v8h-9v-8Zm9 2.5h3.2l2.3 2.5v3h-2.3m-9.4 0h6.4M6 15.7a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0Zm10 0a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0Z",
  },
  {
    title: "WhatsApp at the centre",
    body: "Share your store, confirm orders and keep customers updated in the conversations you already have.",
    icon: "M10 2.5a7.5 7.5 0 0 0-6.4 11.4L2.5 17.5l3.7-1A7.5 7.5 0 1 0 10 2.5Zm-2.5 5.4c.9 2.3 2.3 3.7 4.6 4.6l1-1.3 1.9.9c-.3 1.3-1.3 1.9-2.5 1.6-2.9-.7-5.5-3.3-6.2-6.2-.3-1.2.3-2.2 1.6-2.5l.9 1.9-1.3 1Z",
  },
];

type Plan = {
  name: string;
  price: string;
  featured?: boolean;
  features: string[];
  cta: string;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    price: "Free to start",
    features: ["Your mobile storefront", "Paystack payments", "Guest checkout", "Basic order management"],
    cta: "Start free",
  },
  {
    name: "Growth",
    price: "Configured for your market",
    featured: true,
    features: [
      "Everything in Free",
      "Promotions and discount campaigns",
      "Customer records and segments",
      "Delivery zones and fees",
      "Sales analytics",
    ],
    cta: "Choose Growth",
  },
  {
    name: "Scale",
    price: "Configured for your market",
    features: ["Everything in Growth", "Multiple staff accounts", "Advanced analytics", "Priority support"],
    cta: "Choose Scale",
  },
];

/* ----------------------------- page ------------------------------------- */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#211B14] antialiased">
      {/* ============ NAV ============ */}
      <header className="sticky top-0 z-50 border-b border-[#EAE2D6] bg-[#FAF7F2]/90 backdrop-blur">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-5">
          <Link
            href="/"
            aria-label="SnapDuka home"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-[#211B14] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A8431A]"
          >
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-lg bg-[#A8431A] font-serif text-base font-bold text-white">
              S
            </span>
            SnapDuka
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded text-[14.5px] font-medium text-[#57504A] transition-colors hover:text-[#211B14] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A8431A]"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="rounded-lg px-3.5 py-2 text-[14.5px] font-semibold text-[#211B14] transition-colors hover:bg-[#F1EAE0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A8431A]"
            >
              Sign in
            </Link>
            <Link
              href="/onboarding"
              className="rounded-[9px] bg-[#A8431A] px-4.5 py-2.5 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#8A3612] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#211B14]"
            >
              Create your storefront
            </Link>
          </div>

          {/* Mobile menu — native disclosure, no JS required */}
          <details className="group relative md:hidden">
            <summary
              aria-label="Toggle menu"
              className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-[10px] border border-[#E2D9CC] bg-white text-[#211B14] [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A8431A]"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="group-open:hidden">
                <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="hidden group-open:block">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="absolute right-0 top-[calc(100%+10px)] flex w-[calc(100vw-40px)] max-w-72 flex-col gap-1 rounded-2xl border border-[#EAE2D6] bg-[#FAF7F2] p-3 shadow-xl">
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} className="rounded-lg px-3 py-3 text-base font-medium text-[#211B14] hover:bg-[#F1EAE0]">
                  {l.label}
                </a>
              ))}
              <Link href="/login" className="rounded-lg px-3 py-3 text-base font-medium text-[#211B14] hover:bg-[#F1EAE0]">
                Sign in
              </Link>
              <Link
                href="/onboarding"
                className="mt-2 rounded-[10px] bg-[#A8431A] px-4 py-3.5 text-center text-[15.5px] font-semibold text-white hover:bg-[#8A3612]"
              >
                Create your storefront
              </Link>
            </div>
          </details>
        </nav>
      </header>

      <main className="sd-main">
        {/* ============ HERO ============ */}
        <section
          aria-labelledby="hero-heading"
          className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-10 px-5 pb-14 pt-14 sm:pt-20 lg:grid-cols-2 lg:gap-16 lg:pb-20 lg:pt-24"
        >
          <div className="motion-safe:animate-[sd-fade-up_0.6s_ease_both]">
            <p className="mb-4.5 inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#A8431A]">
              <span aria-hidden="true" className="inline-block h-px w-5 bg-[#A8431A]" />
              Social commerce, organized
            </p>
            <h1
              id="hero-heading"
              className="mb-5 font-serif text-[clamp(34px,5.2vw,56px)] font-medium leading-[1.08] tracking-[-0.015em] text-balance"
            >
              Your social audience is ready to buy. Give them a checkout.
            </h1>
            <p className="mb-8 max-w-[52ch] text-[clamp(16px,1.6vw,18.5px)] leading-[1.65] text-[#57504A] text-pretty">
              Turn Instagram, TikTok, Snapchat and WhatsApp interest into organized, trackable orders with a storefront built for
              African social sellers.
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#A8431A] px-6.5 py-3.5 text-base font-semibold text-white shadow-md shadow-[#8A3612]/20 transition hover:-translate-y-px hover:bg-[#8A3612] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#211B14] motion-reduce:hover:translate-y-0"
              >
                Create your storefront
                <ArrowIcon />
              </Link>
              <Link
                href="/discover"
                className="rounded-[10px] border border-[#DCD2C3] bg-white px-5.5 py-3.5 text-base font-semibold text-[#211B14] transition-colors hover:border-[#B9AC98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A8431A]"
              >
                Explore live stores
              </Link>
            </div>
            <p className="mt-5 text-[13.5px] text-[#837A70]">No card required · Launch in minutes</p>
          </div>

          {/* Hero visual: product composition */}
          <div role="img" aria-label="Preview of a SnapDuka storefront, checkout and paid-order notification" className="relative grid min-h-[480px] place-items-center py-3">
            <span
              aria-hidden="true"
              className="absolute inset-x-[4%] inset-y-[8%] rounded-[40px] bg-[radial-gradient(ellipse_at_60%_40%,#F0E4D6_0%,transparent_65%)]"
            />

            {/* Phone storefront */}
            <div className="relative w-[min(280px,78vw)] rounded-[34px] bg-[#211B14] p-2.5 shadow-[0_24px_48px_-18px_rgba(33,27,20,0.35),0_4px_12px_rgba(33,27,20,0.12)] motion-safe:animate-[sd-float_7s_ease-in-out_infinite]">
              <div className="overflow-hidden rounded-[26px] bg-[#FFFDF9]">
                <div className="grid h-6.5 place-items-center">
                  <span className="block h-[7px] w-[74px] rounded bg-[#E8E0D3]" />
                </div>
                <div className="flex items-center gap-2.5 border-b border-[#F0EAE0] px-4 pb-2.5 pt-3">
                  <span aria-hidden="true" className="h-8.5 w-8.5 shrink-0 rounded-full bg-[linear-gradient(135deg,#D9C6A8,#A8875D)]" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13.5px] font-bold">
                      Ama&rsquo;s Closet
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-label="Verified seller">
                        <circle cx="7" cy="7" r="6.4" fill="#047857" />
                        <path d="M4.4 7.2 6.2 9l3.4-3.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </p>
                    <p className="text-[10.5px] text-[#837A70]">Accra · Delivers nationwide</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 px-3.5 pb-4 pt-3">
                  {PRODUCTS.map((p) => (
                    <div key={p.name} className="overflow-hidden rounded-xl border border-[#F0EAE0] bg-white">
                      <span aria-hidden="true" className="block h-[72px]" style={{ background: p.swatch }} />
                      <div className="px-2 pb-2 pt-2">
                        <p className="mb-0.5 truncate text-[11px] font-semibold">{p.name}</p>
                        <p className="text-[11px] font-bold text-[#6B4F35]">{p.price}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3.5 pb-4">
                  <span className="block rounded-[10px] bg-[#A8431A] py-2.5 text-center text-[12.5px] font-semibold text-white">
                    View cart · 2 items
                  </span>
                </div>
              </div>
            </div>

            {/* Checkout panel */}
            <div className="absolute bottom-[6%] left-0 w-[min(230px,62vw)] rounded-2xl border border-[#EAE2D6] bg-white p-4 shadow-[0_16px_36px_-14px_rgba(33,27,20,0.28)] motion-safe:animate-[sd-float_8s_ease-in-out_0.8s_infinite] lg:left-6">
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-[#837A70]">Checkout</p>
              <div className="mb-1.5 flex justify-between gap-2 text-[12.5px] text-[#57504A]">
                <span>Subtotal</span>
                <span className="font-semibold text-[#211B14]">GHS 425.00</span>
              </div>
              <div className="mb-3 flex justify-between gap-2 text-[12.5px] text-[#57504A]">
                <span>Delivery · Accra</span>
                <span className="font-semibold text-[#211B14]">GHS 25.00</span>
              </div>
              <span className="block rounded-[9px] bg-[#047857] py-2.5 text-center text-[12.5px] font-semibold text-white">
                Pay GHS 450.00 with Paystack
              </span>
              <p className="mt-2 text-center text-[10.5px] text-[#837A70]">Guest checkout · No account needed</p>
            </div>

            {/* Paid-order notification */}
            <div className="absolute right-0 top-[5%] flex w-[min(240px,64vw)] items-start gap-2.5 rounded-[14px] border border-[#EAE2D6] bg-white px-3.5 py-3 shadow-[0_14px_30px_-12px_rgba(33,27,20,0.26)] motion-safe:animate-[sd-toast-in_0.7s_ease_0.9s_both] lg:right-5">
              <span aria-hidden="true" className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-[10px] bg-[#E7F4EE]">
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M3.5 9.5 7 13l7.5-8" stroke="#047857" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="mb-0.5 text-[12.5px] font-bold">New paid order</p>
                <p className="text-[11.5px] leading-[1.45] text-[#57504A]">Order #1042 · GHS 450.00 received via Paystack</p>
              </div>
            </div>

            <p className="absolute -bottom-1.5 right-1.5 text-[10.5px] tracking-wide text-[#A79D91]">Product preview</p>
          </div>
        </section>

        {/* ============ TRUST STRIP ============ */}
        <section aria-label="Platform facts" className="border-y border-[#EAE2D6] bg-[#FFFDF9]">
          <ul className="mx-auto flex max-w-[1120px] flex-wrap justify-center gap-x-8 gap-y-2.5 px-5 py-4.5">
            {TRUST_ITEMS.map((t) => (
              <li key={t} className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-[#57504A]">
                <span aria-hidden="true" className="inline-block h-[5px] w-[5px] rounded-full bg-[#A8431A]" />
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section id="how-it-works" aria-labelledby="how-heading" className="mx-auto max-w-[1120px] scroll-mt-20 px-5 py-16 lg:py-28">
          <p className="mb-3.5 text-center text-[13px] font-semibold uppercase tracking-[0.08em] text-[#A8431A]">How it works</p>
          <h2
            id="how-heading"
            className="mx-auto mb-14 max-w-[22ch] text-center font-serif text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.01em] text-balance"
          >
            From social post to paid order
          </h2>
          <ol className="grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.num} className="relative rounded-2xl border border-[#EAE2D6] bg-white px-6.5 pb-7.5 pt-7">
                <span aria-hidden="true" className="absolute right-6 top-6 font-serif text-[40px] leading-none text-[#EDE4D6]">
                  {s.num}
                </span>
                <span aria-hidden="true" className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-[#F6EDE2] text-[#A8431A]">
                  <StrokeIcon d={s.icon} />
                </span>
                <h3 className="mb-2 text-lg font-bold tracking-[-0.01em]">{s.title}</h3>
                <p className="text-[14.5px] leading-[1.6] text-[#57504A]">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ============ PRODUCT: STOREFRONT ============ */}
        <section id="product" aria-labelledby="storefront-heading" className="scroll-mt-20 border-t border-[#EAE2D6] bg-[#FFFDF9]">
          <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-10 px-5 py-16 lg:grid-cols-2 lg:gap-18 lg:py-28">
            <div>
              <p className="mb-3.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#A8431A]">For your customers</p>
              <h2
                id="storefront-heading"
                className="mb-4.5 font-serif text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.01em] text-balance"
              >
                A storefront customers trust
              </h2>
              <p className="mb-7 max-w-[50ch] text-base leading-[1.65] text-[#57504A]">
                Buying from a DM thread means screenshots, transfers and hoping for the best. Your SnapDuka storefront replaces that
                with a clear catalogue and a proper checkout.
              </p>
              <ul className="grid list-none gap-3.5 p-0">
                {STOREFRONT_POINTS.map((pt) => (
                  <li key={pt.lead} className="flex items-start gap-3 text-[15px] leading-[1.55] text-[#3E3730]">
                    <CheckCircleIcon />
                    <span>
                      <strong className="font-semibold text-[#211B14]">{pt.lead}</strong> — {pt.rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Storefront preview */}
            <div role="img" aria-label="Preview of a SnapDuka product page" className="grid place-items-center">
              <div className="w-full max-w-[400px] overflow-hidden rounded-[18px] border border-[#EAE2D6] bg-white shadow-[0_20px_44px_-20px_rgba(33,27,20,0.25)]">
                <div className="flex items-center justify-between gap-2.5 border-b border-[#F0EAE0] px-4.5 py-3.5">
                  <span className="text-[13px] font-bold">Ama&rsquo;s Closet</span>
                  <VerifiedBadge />
                </div>
                <div className="grid grid-cols-[112px_1fr] gap-4 p-4.5 sm:grid-cols-[132px_1fr]">
                  <span aria-hidden="true" className="block h-[150px] rounded-xl bg-[linear-gradient(150deg,#E4D5BF_0%,#C7AE8A_55%,#A8875D_100%)]" />
                  <div>
                    <p className="mb-1 text-[15.5px] font-bold">Two-piece linen set</p>
                    <p className="mb-3 text-[15px] font-bold text-[#6B4F35]">GHS 240.00</p>
                    <div className="mb-3.5 flex gap-1.5">
                      <span className="rounded-[7px] border-[1.5px] border-[#A8431A] px-2.5 py-1 text-[11px] font-semibold text-[#A8431A]">M</span>
                      <span className="rounded-[7px] border border-[#E2D9CC] px-2.5 py-1 text-[11px] font-semibold text-[#57504A]">L</span>
                      <span className="rounded-[7px] border border-[#E2D9CC] px-2.5 py-1 text-[11px] font-semibold text-[#57504A]">XL</span>
                    </div>
                    <span className="block rounded-[9px] bg-[#211B14] py-2.5 text-center text-[12.5px] font-semibold text-white">Add to cart</span>
                  </div>
                </div>
                <div className="flex justify-between gap-2.5 border-t border-[#F0EAE0] px-4.5 py-3 text-xs text-[#837A70]">
                  <span>Delivery or pickup · Accra</span>
                  <span className="font-semibold text-[#57504A]">Guest checkout</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ PRODUCT: DASHBOARD ============ */}
        <section
          aria-labelledby="dashboard-heading"
          className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-10 px-5 py-16 lg:grid-cols-2 lg:gap-18 lg:py-28"
        >
          {/* Dashboard preview */}
          <div role="img" aria-label="Preview of the SnapDuka seller dashboard" className="order-2 grid place-items-center lg:order-1">
            <div className="w-full max-w-[440px] overflow-hidden rounded-[18px] border border-[#EAE2D6] bg-white shadow-[0_20px_44px_-20px_rgba(33,27,20,0.25)]">
              <div className="flex items-center justify-between border-b border-[#F0EAE0] px-4.5 py-3.5">
                <span className="text-[13px] font-bold">Orders</span>
                <span className="text-[11.5px] font-semibold text-[#837A70]">This week</span>
              </div>
              <div className="px-1.5 py-2">
                {ORDERS.map((o) => (
                  <div key={o.ref} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-[#FAF7F2]">
                    <span aria-hidden="true" className="block h-8 w-8 rounded-[9px]" style={{ background: o.swatch }} />
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold">{o.customer}</p>
                      <p className="text-[11px] text-[#837A70]">
                        {o.ref} · {o.channel}
                      </p>
                    </div>
                    <span className="text-xs font-bold">{o.amount}</span>
                    <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10.5px] font-bold ${o.badge}`}>{o.status}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-4.5 border-t border-[#F0EAE0] px-4.5 py-3 text-[11.5px] text-[#837A70]">
                <span>
                  <strong className="font-bold text-[#211B14]">14</strong> orders
                </span>
                <span>
                  <strong className="font-bold text-[#047857]">11</strong> paid
                </span>
                <span>
                  <strong className="font-bold text-[#211B14]">3</strong> out for delivery
                </span>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <p className="mb-3.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#A8431A]">For you</p>
            <h2
              id="dashboard-heading"
              className="mb-4.5 font-serif text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.01em] text-balance"
            >
              One reliable place for every order
            </h2>
            <p className="mb-7 max-w-[50ch] text-base leading-[1.65] text-[#57504A]">
              No more scrolling chat history to work out who paid and what still needs to ship. Everything that happens in your
              store lands in one dashboard.
            </p>
            <ul className="grid list-none gap-3.5 p-0">
              {DASHBOARD_POINTS.map((pt) => (
                <li key={pt.lead} className="flex items-start gap-3 text-[15px] leading-[1.55] text-[#3E3730]">
                  <CheckCircleIcon />
                  <span>
                    <strong className="font-semibold text-[#211B14]">{pt.lead}</strong> — {pt.rest}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ============ REGIONAL ============ */}
        <section aria-labelledby="regional-heading" className="bg-[#211B14]">
          <div className="mx-auto max-w-[1120px] px-5 py-16 lg:py-28">
            <p className="mb-3.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#D9986F]">Regional by design</p>
            <h2
              id="regional-heading"
              className="mb-4.5 max-w-[20ch] font-serif text-[clamp(28px,3.8vw,42px)] font-medium leading-[1.15] tracking-[-0.01em] text-[#FAF7F2] text-balance"
            >
              Built for how commerce moves across West Africa
            </h2>
            <p className="mb-12 max-w-[58ch] text-base leading-[1.65] text-[#B8AEA1]">
              SnapDuka serves sellers in Ghana, Nigeria and Côte d&rsquo;Ivoire — with local currencies, mobile-first buying, and
              the way orders actually get arranged: over WhatsApp.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {REGIONAL_ITEMS.map((r) => (
                <div key={r.title} className="rounded-[14px] border border-[#FAF7F2]/15 p-5 pt-5.5">
                  <span aria-hidden="true" className="mb-4 grid h-9.5 w-9.5 place-items-center rounded-[10px] bg-[#FAF7F2]/10 text-[#D9986F]">
                    <StrokeIcon d={r.icon} />
                  </span>
                  <h3 className="mb-1.5 text-[15.5px] font-bold text-[#FAF7F2]">{r.title}</h3>
                  <p className="text-[13.5px] leading-[1.6] text-[#B8AEA1]">{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ PRICING ============ */}
        <section id="pricing" aria-labelledby="pricing-heading" className="mx-auto max-w-[1120px] scroll-mt-20 px-5 py-16 lg:py-28">
          <p className="mb-3.5 text-center text-[13px] font-semibold uppercase tracking-[0.08em] text-[#A8431A]">Pricing</p>
          <h2
            id="pricing-heading"
            className="mx-auto mb-4 max-w-[24ch] text-center font-serif text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.01em] text-balance"
          >
            Start free. Upgrade when your business grows.
          </h2>
          <p className="mx-auto mb-13 max-w-[52ch] text-center text-base leading-relaxed text-[#57504A]">
            Plans are configured for your market and billed in your local currency.
          </p>
          <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-[18px] p-7 ${
                  plan.featured ? "border border-[#211B14] bg-[#211B14]" : "border border-[#EAE2D6] bg-white"
                }`}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-7 rounded-full bg-[#A8431A] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                    Most popular
                  </span>
                )}
                <h3 className={`mb-1.5 text-[19px] font-bold ${plan.featured ? "text-[#FAF7F2]" : "text-[#211B14]"}`}>{plan.name}</h3>
                <p className={`mb-5.5 font-serif text-[17px] ${plan.featured ? "text-[#B8AEA1]" : "text-[#57504A]"}`}>{plan.price}</p>
                <ul className="mb-7 grid flex-1 list-none gap-2.5 p-0">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className={`flex items-start gap-2.5 text-sm leading-normal ${plan.featured ? "text-[#D6CCBF]" : "text-[#57504A]"}`}
                    >
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-[3px] shrink-0">
                        <path
                          d="M3 8.5 6.2 11.5 13 4.5"
                          stroke={plan.featured ? "#D9986F" : "#A79D91"}
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/onboarding"
                  className={`block rounded-[10px] py-3 text-center text-[14.5px] font-semibold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A8431A] ${
                    plan.featured ? "bg-[#A8431A] text-white" : "border border-[#DCD2C3] bg-white text-[#211B14]"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* ============ FINAL CTA ============ */}
        <section aria-labelledby="final-heading" className="mx-auto max-w-[1120px] px-5 pb-16 lg:pb-28">
          <div className="relative overflow-hidden rounded-3xl border border-[#EAE2D6] bg-[#FFFDF9] px-6 py-12 text-center sm:px-12 lg:px-18 lg:py-22">
            <span aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,#F4E7D8_0%,transparent_60%)]" />
            <div className="relative">
              <h2
                id="final-heading"
                className="mx-auto mb-4 max-w-[20ch] font-serif text-[clamp(30px,4.2vw,46px)] font-medium leading-[1.12] tracking-[-0.015em] text-balance"
              >
                Your next customer is already following you.
              </h2>
              <p className="mx-auto mb-8.5 max-w-[40ch] text-[17px] leading-relaxed text-[#57504A]">
                Give them a faster, more trustworthy way to buy.
              </p>
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 rounded-[11px] bg-[#A8431A] px-7.5 py-4 text-[16.5px] font-semibold text-white shadow-md shadow-[#8A3612]/25 transition hover:-translate-y-px hover:bg-[#8A3612] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#211B14] motion-reduce:hover:translate-y-0"
              >
                Create your storefront
                <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-[#EAE2D6] bg-[#FAF7F2]">
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-9 px-5 pb-10 pt-12 sm:grid-cols-2 lg:grid-cols-3">
          <div className="max-w-[34ch]">
            <p className="mb-2.5 flex items-center gap-2 text-base font-bold">
              <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-[7px] bg-[#A8431A] font-serif text-sm text-white">
                S
              </span>
              SnapDuka
            </p>
            <p className="text-[13.5px] leading-relaxed text-[#837A70]">
              Mobile storefronts, payments and order management for social sellers.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-10">
            <div className="grid content-start gap-2.5">
              <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-[0.07em] text-[#A79D91]">Explore</p>
              <Link href="/discover" className="text-sm text-[#57504A] hover:text-[#211B14]">
                Discover stores
              </Link>
              <Link href="/login" className="text-sm text-[#57504A] hover:text-[#211B14]">
                Sign in
              </Link>
            </div>
            <div className="grid content-start gap-2.5">
              <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-[0.07em] text-[#A79D91]">Legal</p>
              <Link href="/privacy" className="text-sm text-[#57504A] hover:text-[#211B14]">
                Privacy
              </Link>
              <Link href="/terms" className="text-sm text-[#57504A] hover:text-[#211B14]">
                Terms
              </Link>
            </div>
          </nav>
          <div className="grid content-start gap-2.5">
            <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-[0.07em] text-[#A79D91]">Serving</p>
            <p className="text-sm leading-[1.7] text-[#57504A]">
              Ghana · Nigeria · Côte d&rsquo;Ivoire
              <br />
              GHS · NGN · XOF
            </p>
          </div>
        </div>
        <div className="border-t border-[#EAE2D6]">
          <p className="mx-auto max-w-[1120px] px-5 py-4.5 text-[12.5px] text-[#A79D91]">
            © {new Date().getFullYear()} SnapDuka. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
