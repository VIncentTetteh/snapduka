import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-options";

/**
 * Edge runtime (proxy.ts and any edge route). Same policy as the server: the
 * scrubber and sampler are runtime-agnostic. No-op without a DSN.
 */
const options = sharedSentryOptions({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
});

if (options) Sentry.init(options);
