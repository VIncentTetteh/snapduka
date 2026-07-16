import { NextResponse, type NextRequest } from "next/server";

import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { sealToken } from "@/lib/social/crypto";
import {
  exchangeCode,
  isSocialProviderConfigured,
  parseSocialProvider,
} from "@/lib/social/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function back(origin: string, query: string) {
  return NextResponse.redirect(new URL(`/dashboard/share?tab=accounts&${query}`, origin));
}

/** OAuth return: verify state, exchange the code, store sealed tokens. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const origin = (await appOrigin().catch(() => null)) ?? request.nextUrl.origin;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") {
    return NextResponse.redirect(new URL("/login?next=/dashboard/share?tab=accounts", origin));
  }

  const provider = parseSocialProvider((await params).provider);
  if (!provider || !isSocialProviderConfigured(provider)) {
    return back(origin, "error=provider-unavailable");
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(`social_oauth_state_${provider}`)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return back(origin, "error=connect-denied");
  }

  try {
    const token = await exchangeCode(provider, origin, code);
    const admin = createAdminClient();
    const { error } = await admin.from("social_accounts").upsert(
      {
        seller_account_id: actor.sellerAccountId,
        provider,
        external_id: token.externalId,
        handle: token.handle,
        access_token_sealed: sealToken(token.accessToken),
        refresh_token_sealed: token.refreshToken ? sealToken(token.refreshToken) : null,
        token_expires_at: token.expiresAt,
        scopes: token.scopes,
        status: "connected",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "seller_account_id,provider" },
    );
    if (error) {
      return back(origin, "error=connect-failed");
    }
    const response = back(origin, `connected=${provider}`);
    response.cookies.delete(`social_oauth_state_${provider}`);
    return response;
  } catch {
    return back(origin, "error=connect-failed");
  }
}
