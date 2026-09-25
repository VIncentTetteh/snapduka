import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-options";

/**
 * Browser instrumentation. Only NEXT_PUBLIC_* values exist here, inlined at
 * build time, so a build without NEXT_PUBLIC_SENTRY_DSN ships no init call's
 * worth of behaviour: `options` is null and nothing starts.
 *
 * Events go through the `/monitoring` tunnel (next.config.ts) so they satisfy
 * the proxy's `connect-src 'self'` CSP and survive ad blockers without adding
 * the Sentry ingest host to the policy.
 */
const options = sharedSentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NEXT_PUBLIC_VERCEL_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
});

if (options) {
  Sentry.init({
    ...options,
    // Session replay would record buyer names, phones and addresses on screen
    // (same reasoning as the mobile app); it stays off.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
