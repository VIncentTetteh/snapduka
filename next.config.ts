// In @sentry/nextjs 11 the build wrapper is exported from the /config entry, not the root.
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @snapduka/core ships TypeScript source with no build step so the Expo app
  // can consume it through Metro; Next has to transpile it the same way.
  transpilePackages: ["@snapduka/core"],
  // Origins allowed to reach the dev server (e.g. testing from a phone on
  // the same network). Extend via ALLOWED_DEV_ORIGINS="ip1,ip2" if needed.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.100.43",
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",").map((origin) => origin.trim()) ?? []),
  ],
};

/**
 * Sentry build integration.
 *
 * Always applied, DSN or not, so the build that runs in CI is the same shape as
 * the one that ships; a wrapper that only appears in production is a wrapper
 * whose breakage is only discovered in production. Without a DSN the runtime
 * side is inert (see src/instrumentation.ts), and without SENTRY_AUTH_TOKEN
 * source maps are neither generated for upload nor sent anywhere.
 */
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || undefined;

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: sentryAuthToken,
  sourcemaps: {
    disable: !sentryAuthToken,
    // Uploaded maps are removed from the deployment so production does not
    // serve our original source to anyone who asks for the .map file.
    deleteSourcemapsAfterUpload: true,
  },
  // Browser events go to /monitoring on our own origin: the proxy's CSP only
  // allows connect-src 'self', and ad blockers drop requests to Sentry's host.
  tunnelRoute: "/monitoring",
  // No build-time phone-home from CI or local builds.
  telemetry: false,
  silent: !process.env.CI,
});
