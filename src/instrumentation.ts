import * as Sentry from "@sentry/nextjs";

/**
 * Next.js server instrumentation hook.
 *
 * The runtime configs are imported only when a DSN exists, so local dev, unit
 * tests and CI never load the SDK's init path at all. `onRequestError` is safe
 * to export unconditionally: with no client initialised, captureRequestError
 * has nothing to send to and returns.
 */
export async function register() {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
