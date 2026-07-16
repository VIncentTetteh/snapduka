import { NextResponse, type NextRequest } from "next/server";

import { appOrigin } from "@/lib/app-url";
import { normalizeCampaignToken } from "@/lib/campaigns/links";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Public short-link redirect: /l/{token} → storefront destination with the
 * campaign token attached, recording a click in campaign_attributions.
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

  // Best-effort click record; the redirect must not fail if this does.
  await admin
    .from("campaign_attributions")
    .insert({
      campaign_id: link.id,
      seller_account_id: link.seller_account_id,
      session_key: crypto.randomUUID(),
    })
    .then(() => undefined);

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
  destination.searchParams.set("campaign", token);
  return NextResponse.redirect(destination);
}
