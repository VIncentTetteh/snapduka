import "server-only";

import type { CountryCode, CurrencyCode } from "@snapduka/core";

import { planFeatureBullets, planUpgradeBullets } from "@/lib/billing/plan-features";
import type { EntitlementValue } from "@/lib/billing/resolve";
import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything the public landing page states about money and features, read
 * from the same rows the product enforces — prices from plan_prices, fees from
 * country_configs, features from their rollout flags — so the page can never
 * advertise a fee or a feature that is not what a seller in that market gets.
 */

export const LANDING_COUNTRIES: readonly CountryCode[] = ["GH", "NG", "CI"];

/** The visitor's market from Vercel's geolocation header; Ghana otherwise. */
export function visitorCountry(requestHeaders: Headers): CountryCode {
  const code = requestHeaders.get("x-vercel-ip-country")?.toUpperCase();
  return (LANDING_COUNTRIES as readonly string[]).includes(code ?? "") ? (code as CountryCode) : "GH";
}

export type LandingPlan = {
  code: "free" | "growth" | "scale";
  name: string;
  /** Monthly price in minor units; 0 for Free; null when not sold in this market. */
  monthlyMinor: number | null;
  /**
   * From the plan's entitlements: everything Free includes, and for paid plans
   * only what they add over the plan below ("Everything in Growth, plus").
   */
  features: string[];
};

export type LandingData = {
  country: CountryCode;
  currency: CurrencyCode;
  plans: LandingPlan[];
  fees: {
    platformBps: number;
    protectBps: number;
    protectMinMinor: number;
    protectCapMinor: number;
    instantPayoutBps: number;
    instantPayoutMinMinor: number;
    inspectionHours: number;
    autoReleaseHours: number;
  };
  /** What is actually switched on for this market. */
  features: {
    protect: boolean;
    whatsappAssistant: boolean;
    snapToList: boolean;
    instantPayout: boolean;
  };
};

const PLAN_ORDER = ["free", "growth", "scale"] as const;

type PlanEntitlementRow = { code: string; name: string; entitlements: unknown };

/** Features per plan, in PLAN_ORDER. */
export function landingPlanFeatures(
  plans: readonly PlanEntitlementRow[],
  options: { customDomains: boolean },
): { code: LandingPlan["code"]; name: string; features: string[] }[] {
  const entitlementsOf = (code: string) =>
    (plans.find((row) => row.code === code)?.entitlements ?? {}) as Record<string, EntitlementValue>;
  return PLAN_ORDER.map((code, index) => ({
    code,
    name: plans.find((row) => row.code === code)?.name ?? code[0]!.toUpperCase() + code.slice(1),
    features:
      index === 0
        ? planFeatureBullets(entitlementsOf(code), options)
        : planUpgradeBullets(entitlementsOf(PLAN_ORDER[index - 1]!), entitlementsOf(code), options),
  }));
}

/** The active plans and what each includes, for the classic page (which does not price by market). */
export async function getPlanFeatures(country: CountryCode) {
  const admin = createAdminClient();
  const [{ data: plans }, customDomains] = await Promise.all([
    admin.from("plans").select("code,name,entitlements").eq("active", true).in("code", [...PLAN_ORDER]),
    isFeatureEnabled("custom_domains", { country }),
  ]);
  return landingPlanFeatures(plans ?? [], { customDomains });
}

export async function getLandingData(country: CountryCode): Promise<LandingData> {
  const admin = createAdminClient();
  const [{ data: config }, { data: plans }, protectFlag, waAgent, snapToList, instantPayout, customDomains] =
    await Promise.all([
    admin
      .from("country_configs")
      .select(
        "currency,platform_fee_bps,protect_enabled,protect_fee_bps,protect_fee_min_minor,protect_fee_cap_minor,instant_payout_fee_bps,instant_payout_fee_min_minor,protect_inspection_hours,protect_auto_release_hours",
      )
      .eq("country", country)
      .maybeSingle(),
    admin
      .from("plans")
      .select("code,name,entitlements,plan_prices(country,interval,amount_minor,active)")
      .eq("active", true)
      .in("code", [...PLAN_ORDER]),
    isFeatureEnabled("protect", { country }),
    isFeatureEnabled("wa_agent", { country }),
    isFeatureEnabled("snap_to_list", { country }),
    isFeatureEnabled("instant_payout", { country }),
    isFeatureEnabled("custom_domains", { country }),
  ]);

  const features = landingPlanFeatures(plans ?? [], { customDomains });

  const landingPlans: LandingPlan[] = PLAN_ORDER.map((code) => {
    const plan = (plans ?? []).find((row) => row.code === code);
    const prices = (plan?.plan_prices ?? []) as { country: string; interval: string; amount_minor: number; active: boolean }[];
    const monthly = prices.find((price) => price.country === country && price.interval === "monthly" && price.active);
    return {
      code,
      name: plan?.name ?? code[0]!.toUpperCase() + code.slice(1),
      monthlyMinor: code === "free" ? 0 : (monthly?.amount_minor ?? null),
      features: features.find((entry) => entry.code === code)?.features ?? [],
    };
  });

  return {
    country,
    currency: (config?.currency ?? "GHS") as CurrencyCode,
    plans: landingPlans,
    fees: {
      platformBps: config?.platform_fee_bps ?? 700,
      protectBps: config?.protect_fee_bps ?? 150,
      protectMinMinor: config?.protect_fee_min_minor ?? 0,
      protectCapMinor: config?.protect_fee_cap_minor ?? 0,
      instantPayoutBps: config?.instant_payout_fee_bps ?? 100,
      instantPayoutMinMinor: config?.instant_payout_fee_min_minor ?? 0,
      inspectionHours: config?.protect_inspection_hours ?? 24,
      autoReleaseHours: config?.protect_auto_release_hours ?? 168,
    },
    features: {
      // Both switches: the market's legal switch and the rollout flag.
      protect: Boolean(config?.protect_enabled) && protectFlag,
      whatsappAssistant: waAgent,
      snapToList,
      instantPayout,
    },
  };
}
