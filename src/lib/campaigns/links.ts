export function normalizeCampaignToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
export function campaignUrl(storefrontUrl: string, token: string) {
  const url = new URL(storefrontUrl);
  url.searchParams.set("campaign", normalizeCampaignToken(token));
  return url.toString();
}
