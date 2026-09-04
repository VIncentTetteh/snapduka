import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Reading campaigns.
 *
 * Everything here goes through the RLS-scoped client — `campaigns_owner_all`
 * already restricts a seller to their own rows, so there is no account id to
 * pass and nothing to forge.
 */

export type CampaignStatus = "draft" | "active" | "paused" | "ended";

export type CampaignTotals = { clicks: number; orders: number; revenueMinor: number };

export type CampaignRow = {
  id: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  budget_minor: number | null;
  spend_minor: number;
  creative_path: string | null;
  notes: string | null;
  created_at: string;
};

const CAMPAIGN_COLUMNS =
  "id,name,objective,status,starts_at,ends_at,budget_minor,spend_minor,creative_path,notes,created_at";

const EMPTY_TOTALS: CampaignTotals = { clicks: 0, orders: 0, revenueMinor: 0 };

/**
 * Clicks, orders and revenue for every campaign the caller can see, in one
 * call. The alternative — a query per campaign — is the same trap the analytics
 * dashboards fell into, and a seller with twenty campaigns would feel it.
 */
export async function fetchCampaignTotals(): Promise<Map<string, CampaignTotals>> {
  const supabase = await createClient();
  const totals = new Map<string, CampaignTotals>();

  const { data, error } = await supabase.rpc("campaign_totals");
  // Numbers are the reason to open this page, but a campaign with no figures is
  // still worth showing; treat a failure as "no data yet" rather than blanking
  // the list.
  if (error) return totals;

  for (const row of data ?? []) {
    if (!row.campaign_id) continue;
    totals.set(row.campaign_id, {
      // Every column comes back as bigint, so every one needs casting.
      clicks: Number(row.clicks),
      orders: Number(row.orders),
      revenueMinor: Number(row.revenue_minor),
    });
  }
  return totals;
}

export function totalsFor(
  totals: Map<string, CampaignTotals>,
  campaignId: string,
): CampaignTotals {
  return totals.get(campaignId) ?? EMPTY_TOTALS;
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error("Unable to load campaigns.", { cause: error });
  return (data ?? []) as CampaignRow[];
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error("Unable to load this campaign.", { cause: error });
  return (data as CampaignRow | null) ?? null;
}

export type CampaignLinkRow = {
  id: string;
  name: string;
  token: string;
  channel: string;
  destination_path: string;
  active: boolean;
};

export async function getCampaignLinks(campaignId: string): Promise<CampaignLinkRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_links")
    .select("id,name,token,channel,destination_path,active")
    .eq("campaign_id", campaignId)
    .eq("active", true)
    .order("channel");

  if (error) throw new Error("Unable to load this campaign's links.", { cause: error });
  return (data ?? []) as CampaignLinkRow[];
}

/** Per-link clicks and orders, for the channel breakdown under the totals. */
export async function fetchLinkTotals(): Promise<Map<string, { clicks: number; orders: number }>> {
  const supabase = await createClient();
  const totals = new Map<string, { clicks: number; orders: number }>();

  const { data, error } = await supabase.rpc("campaign_link_totals");
  if (error) return totals;

  for (const row of data ?? []) {
    totals.set(row.campaign_id, { clicks: Number(row.clicks), orders: Number(row.orders) });
  }
  return totals;
}

export type CampaignProduct = { id: string; name: string; currency: string; price_minor: number };

export async function getCampaignProducts(campaignId: string): Promise<CampaignProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_products")
    .select("products(id,name,currency,price_minor)")
    .eq("campaign_id", campaignId);

  if (error) return [];
  return (data ?? [])
    .map((row) => row.products as unknown as CampaignProduct | null)
    .filter((product): product is CampaignProduct => Boolean(product));
}

/** Public URL for a campaign's creative, or null when none was uploaded. */
export function campaignCreativeUrl(objectPath: string | null | undefined): string | null {
  if (!objectPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/campaign-media/${objectPath}`;
}
