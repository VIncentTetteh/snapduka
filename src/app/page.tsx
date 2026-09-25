import type { Metadata } from "next";
import { headers } from "next/headers";

import { ClassicLanding } from "@/components/landing/classic-landing";
import { TrustLanding } from "@/components/landing/trust-landing";
import { isFeatureEnabled } from "@/lib/flags";
import { getLandingData, visitorCountry, type LandingData } from "@/lib/landing/data";

/**
 * The public landing page, chosen per visitor market.
 *
 * The trust-led page promises SnapDuka Protect, so it is shown only where the
 * `new_homepage` flag is on AND Protect is genuinely live for that market
 * (market switch plus rollout flag). Everywhere else — and if anything about
 * that lookup fails — visitors get the classic storefront page, which makes no
 * such promise.
 */

// Per-visitor (reads the geolocation header), so never prerendered: a static
// build would bake in whichever page the build machine saw.
export const dynamic = "force-dynamic";

async function trustLandingData(): Promise<LandingData | null> {
  // Outside the try: headers() signals dynamic rendering by throwing, and
  // catching that would silently freeze the classic page in at build time.
  const country = visitorCountry(await headers());
  try {
    if (!(await isFeatureEnabled("new_homepage", { country }))) return null;
    const data = await getLandingData(country);
    return data.features.protect ? data : null;
  } catch (error) {
    console.error("[landing] falling back to the classic page", error);
    return null;
  }
}

const CLASSIC_METADATA: Metadata = {
  title: "SnapDuka — Your social audience is ready to buy. Give them a checkout.",
  description:
    "Turn Instagram, TikTok, Snapchat and WhatsApp interest into organized, trackable orders with a storefront built for African social sellers. GHS, NGN and XOF. Online or cash payment. Guest checkout.",
};

const TRUST_METADATA: Metadata = {
  title: "SnapDuka — Get paid before you ship, without scaring buyers away",
  description:
    "SnapDuka Protect holds your buyer’s payment until their order arrives, so strangers pay you up front. Sell in WhatsApp, list from a photo, withdraw to mobile money.",
};

export async function generateMetadata(): Promise<Metadata> {
  return (await trustLandingData()) ? TRUST_METADATA : CLASSIC_METADATA;
}

export default async function HomePage() {
  const data = await trustLandingData();
  return data ? <TrustLanding data={data} /> : <ClassicLanding />;
}
