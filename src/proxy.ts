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

  const nonce = btoa(crypto.randomUUID());
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy(url, nonce));
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request: { headers: requestHeaders } });

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
      const rewriteResponse = NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } });
      response.cookies.getAll().forEach((cookie) => rewriteResponse.cookies.set(cookie));
      applySecurityHeaders(rewriteResponse, url, nonce);
      return rewriteResponse;
    }
  }

  applySecurityHeaders(response, url, nonce);
  return response;
}

function contentSecurityPolicy(supabaseUrl: string, nonce: string) {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const developmentEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentEval} https://js.paystack.co`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} https://api.paystack.co wss:`,
    `img-src 'self' data: https: ${supabaseOrigin}`,
    "frame-src https://js.paystack.co https://checkout.paystack.com https://www.youtube-nocookie.com https://www.tiktok.com https://player.vimeo.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.paystack.com",
    ...(process.env.NODE_ENV === "production" && supabaseOrigin.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, supabaseUrl: string, nonce: string) {
  const h = response.headers;

  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()",
  );

  h.set("Content-Security-Policy", contentSecurityPolicy(supabaseUrl, nonce));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
