import type { EntitlementValue } from "./resolve";

/**
 * What a plan includes, in words a seller understands, derived from the same
 * entitlements JSON the product enforces. The billing page and both landing
 * pages use this, so no page can advertise a feature the code does not unlock.
 * Anything a plan row lists but no code checks (courierIntegrations) is left
 * out on purpose.
 */

export type PlanFeatureOptions = {
  /**
   * Custom domains are enforced by plan but not yet connected to hosting (the
   * `custom_domains` flag). Until they are, they are not something to sell.
   */
  customDomains: boolean;
};

export function planFeatureBullets(
  entitlements: Record<string, EntitlementValue>,
  options: PlanFeatureOptions,
): string[] {
  const value = (key: string) => entitlements[key];
  const count = (key: string) => (typeof value(key) === "number" ? Number(value(key)) : 0);
  const bullets: (string | false)[] = [
    count("products") > 0 && `Up to ${count("products")} products`,
    count("staffAccounts") > 1 ? `${count("staffAccounts")} staff accounts` : "Owner account only",
    value("campaigns") === true && "Tracked share links",
    value("creatorProgram") === true &&
      count("creatorPartnerships") > 0 &&
      `Pay up to ${count("creatorPartnerships")} creators on commission`,
    value("promotions") === true && "Discount promotions",
    count("customerSegments") > 0 && `${count("customerSegments")} customer segments`,
    count("broadcastsPerMonth") > 0 && `${count("broadcastsPerMonth")} broadcasts per month`,
    value("branding") === true && "Storefront theming",
    options.customDomains && value("customDomain") === true && "Custom domain",
    value("exports") === true && "CSV order exports",
    count("automationRules") > 0 && `${count("automationRules")} automation rules`,
    count("apiKeys") > 0 && `${count("apiKeys")} API keys + webhooks`,
    value("discovery") === true && "Discovery listing",
  ];
  return bullets.filter((bullet): bullet is string => typeof bullet === "string");
}

/**
 * What a plan adds over the one below it: the bullets of `plan` that the lower
 * plan does not have. "Up to 500 products" differs from "Up to 50 products", so
 * raised limits show up as well as new features.
 */
export function planUpgradeBullets(
  lower: Record<string, EntitlementValue>,
  plan: Record<string, EntitlementValue>,
  options: PlanFeatureOptions,
): string[] {
  const base = new Set(planFeatureBullets(lower, options));
  return planFeatureBullets(plan, options).filter((bullet) => !base.has(bullet));
}
