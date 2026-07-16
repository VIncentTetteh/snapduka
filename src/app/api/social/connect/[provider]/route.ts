import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import {
  authorizeUrl,
  isSocialProviderConfigured,
  parseSocialProvider,
} from "@/lib/social/providers";

export const dynamic = "force-dynamic";

/** Starts the OAuth connect flow for a social publishing account. */
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
    return NextResponse.redirect(
      new URL("/dashboard/share?tab=accounts&error=provider-unavailable", origin),
    );
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(provider, origin, state));
  response.cookies.set(`social_oauth_state_${provider}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 600,
    path: "/api/social",
  });
  return response;
}
