import { type NextRequest, NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const next = safeNextPath(
    request.nextUrl.searchParams.get("next") ?? "/onboarding",
  );
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createClient();

  let confirmed = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
  }

  if (confirmed) {
    return NextResponse.redirect(new URL(next, request.url));
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "error",
    "This confirmation link is invalid or has expired.",
  );
  loginUrl.searchParams.set("next", next);

  return NextResponse.redirect(loginUrl);
}
