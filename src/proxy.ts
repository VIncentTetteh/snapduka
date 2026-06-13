import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!publishableKey) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getClaims();

  const host = request.headers.get("host")?.toLowerCase().replace(/:\d+$/, "");
  const appHost = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).hostname;
  if (host && host !== appHost && !host.endsWith(".vercel.app")) {
    const { data: domain } = await supabase.from("custom_domains").select("shops(slug)").eq("hostname", host).eq("status", "verified").maybeSingle();
    const slug = (domain?.shops as unknown as { slug?: string } | null)?.slug;
    if (slug && request.nextUrl.pathname === "/") {
      const rewritten = request.nextUrl.clone();
      rewritten.pathname = `/${slug}`;
      return NextResponse.rewrite(rewritten, response);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
