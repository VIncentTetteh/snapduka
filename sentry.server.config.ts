import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-options";

/**
 * Node.js runtime. Loaded from src/instrumentation.ts `register()` only when a
 * DSN is present; the null check here is a second guard so importing this file
 * by accident can never start a transport.
 */
const options = sharedSentryOptions({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
});

if (options) Sentry.init(options);
