import type { Breadcrumb, Event } from "@sentry/nextjs";

import { createTracesSampler, defaultTracesSampleRate, type SamplingInput } from "./sampling";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * The options every runtime (browser, Node, edge) shares. Returned as a plain
 * object so each `Sentry.init` call site stays one line and tests can assert
 * on the policy without initialising the SDK.
 */
export type SharedSentryOptions = {
  dsn: string;
  environment: string;
  release: string | undefined;
  sendDefaultPii: false;
  tracesSampler: (context: SamplingInput) => number;
  beforeSend: <T extends Event>(event: T) => T;
  beforeSendTransaction: <T extends Event>(event: T) => T;
  beforeBreadcrumb: (breadcrumb: Breadcrumb) => Breadcrumb;
};

type OptionsEnv = {
  dsn: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
  tracesSampleRate?: string | undefined;
};

/**
 * Returns null when no DSN is configured. Local dev, unit tests and CI have no
 * DSN, and the contract is that Sentry is then a complete no-op: no init, no
 * transport, no network.
 */
export function sharedSentryOptions(env: OptionsEnv): SharedSentryOptions | null {
  const dsn = env.dsn?.trim();
  if (!dsn) return null;
  return {
    dsn,
    environment: env.environment || "production",
    release: env.release || undefined,
    // Never let the SDK attach IPs, cookies or request bodies on its own; the
    // scrubber decides what leaves.
    sendDefaultPii: false,
    tracesSampler: createTracesSampler(defaultTracesSampleRate(env.tracesSampleRate)),
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
