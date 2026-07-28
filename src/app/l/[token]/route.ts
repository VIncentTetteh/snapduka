import { NextResponse, type NextRequest } from "next/server";

import { appOrigin } from "@/lib/app-url";
import {
  ATTRIBUTION_COOKIE,
  VISITOR_COOKIE,
  attributionCookieOptions,
  encodeAttribution,
  fallbackVisitorKey,
  visitorCookieOptions,
} from "@/lib/campaigns/attribution";
import { isNonHumanRequest } from "@/lib/campaigns/bots";
import { normalizeCampaignToken } from "@/lib/campaigns/links";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Public short-link redirect: /l/{token} → storefront destination with the
 * campaign token attached, recording one click per browser per link.
 *
 * Three things happen here that did not before, all because a click can now
 * earn a creator money:
 *  - link-preview crawlers are not recorded at all;
 *  - a repeat visit bumps the existing row instead of inserting another;
 *  - a signed cookie carries the attribution, so it survives the buyer
 *    navigating somewhere that drops ?campaign= (search, Discover, a refresh).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await params;
  const token = normalizeCampaignToken(rawToken);
  const origin = (await appOrigin().catch(() => null)) ?? request.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(new URL("/", origin));
  }

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("campaign_links")
    .select("id,seller_account_id,destination_path,active")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();

  if (!link) {
    return NextResponse.redirect(new URL("/", origin));
  }

  // destination_path is seller-controlled: resolve against our origin and
  // verify the result stayed same-origin so /l/ can never redirect off-site
  // (e.g. a stored "//evil.com" would otherwise resolve protocol-relative).
  const destination = new URL(
    link.destination_path.startsWith("/") ? link.destination_path : `/${link.destination_path}`,
    origin,
  );
  if (destination.origin !== new URL(origin).origin) {
    return NextResponse.redirect(new URL("/", origin));
  }
  // Kept alongside the cookie: some in-app browsers are unreliable with
  // cookies on a redirect chain, and this is the fallback for them.
  destination.searchParams.set("campaign", token);

  // Crawlers still get the redirect — they just do not count as a click.
  if (
    isNonHumanRequest({
      userAgent: request.headers.get("user-agent"),
      purpose: request.headers.get("purpose"),
      secPurpose: request.headers.get("sec-purpose"),
      secFetchMode: request.headers.get("sec-fetch-mode"),
    })
  ) {
    return NextResponse.redirect(destination);
  }

  const existingVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorKey =
    existingVisitor ??
    fallbackVisitorKey({
      ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown",
      userAgent: request.headers.get("user-agent") ?? "unknown",
      campaignId: link.id,
    });

  const clickId = await recordClick(admin, {
    campaignId: link.id,
    sellerAccountId: link.seller_account_id,
    visitorKey,
  });

  const response = NextResponse.redirect(destination);
  // Attribution is best-effort by design: this link is already posted publicly,
  // so a misconfigured secret must degrade to an untracked visit, never to a
  // broken link for the buyer. The ?campaign= param still carries the fallback.
  try {
    if (clickId) {
      response.cookies.set(
        ATTRIBUTION_COOKIE,
        encodeAttribution({ token, clickId, issuedAt: Math.floor(Date.now() / 1000) }),
        attributionCookieOptions(),
      );
    }
    if (!existingVisitor) {
      response.cookies.set(VISITOR_COOKIE, visitorKey, visitorCookieOptions());
    }
  } catch (error) {
    console.error(
      "[campaign-click] attribution cookie not set",
      error instanceof Error ? error.message : "unknown",
    );
  }
  return response;
}

/**
 * Inserts a click, or bumps the existing open one for this browser.
 *
 * Written as insert-then-recover rather than an upsert: the uniqueness lives in
 * a *partial* index (open rows only), which PostgREST's on_conflict cannot
 * target. Returns the row id so the sale can point back at the click, or null
 * if recording failed — the redirect must never depend on it.
 */
async function recordClick(
  admin: ReturnType<typeof createAdminClient>,
  input: { campaignId: string; sellerAccountId: string; visitorKey: string },
): Promise<string | null> {
  const { data: inserted, error } = await admin
    .from("campaign_attributions")
    .insert({
      campaign_id: input.campaignId,
      seller_account_id: input.sellerAccountId,
      session_key: input.visitorKey,
      visitor_key: input.visitorKey,
      source: "link",
    })
    .select("id")
    .maybeSingle();

  if (!error) return inserted?.id ?? null;

  // 23505 means this browser already has an open click on this link.
  if (error.code !== "23505") {
    console.error("[campaign-click] could not record click", error.message);
    return null;
  }

  const { data: existing } = await admin
    .from("campaign_attributions")
    .select("id,click_count")
    .eq("campaign_id", input.campaignId)
    .eq("visitor_key", input.visitorKey)
    .is("order_id", null)
    .maybeSingle();

  if (!existing) return null;

  await admin
    .from("campaign_attributions")
    .update({ click_count: existing.click_count + 1, last_seen_at: new Date().toISOString() })
    .eq("id", existing.id);

  return existing.id;
}
