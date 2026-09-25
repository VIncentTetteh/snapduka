/**
 * Trace sampling policy.
 *
 * 10% of ordinary traffic is plenty to see latency shape and costs little.
 * Money paths are the opposite: a payment webhook that went slow or a payout
 * batch that half-ran is exactly the trace we need when a seller says "my money
 * did not arrive", and they are low volume. Those are always sampled, and they
 * ignore an upstream "not sampled" decision so a browser that happened to drop
 * its trace cannot hide the server side of a payment.
 */

export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
export const MONEY_TRACES_SAMPLE_RATE = 1.0;

/** Path prefixes that move or protect money. Keep in sync with the brief in docs. */
export const MONEY_ROUTE_PREFIXES = [
  "/api/payments/",
  "/api/internal/payouts/",
  "/api/internal/protect/",
];

/** The subset of Sentry's `TracesSamplerSamplingContext` this policy reads. */
export type SamplingInput = {
  name: string;
  attributes?: Record<string, unknown>;
  normalizedRequest?: { url?: string };
  inheritOrSampleWith?: (fallbackSampleRate: number) => number;
};

/**
 * Parse SENTRY_TRACES_SAMPLE_RATE, falling back to the default for anything
 * that is not a number in [0, 1]. A typo in an env var must not turn tracing
 * up to 100% (cost) or silently off.
 */
export function defaultTracesSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRACES_SAMPLE_RATE;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_TRACES_SAMPLE_RATE;
}

export function isMoneyRoute(path: string): boolean {
  const normalized = path.endsWith("/") ? path : `${path}/`;
  return MONEY_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function toPath(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return null;
  }
}

/**
 * Best-effort request path for a span about to be sampled. Span names look
 * like "POST /api/payments/paystack/webhook"; OpenTelemetry attributes and the
 * normalized request carry the raw URL when the name is still generic.
 */
export function samplingPath(context: SamplingInput): string {
  const attributes = context.attributes ?? {};
  const fromAttributes =
    toPath(attributes["url.path"]) ??
    toPath(attributes["http.target"]) ??
    toPath(attributes["http.route"]) ??
    toPath(attributes["next.route"]) ??
    toPath(attributes["url.full"]) ??
    toPath(attributes["http.url"]);
  if (fromAttributes) return fromAttributes;
  const fromRequest = toPath(context.normalizedRequest?.url);
  if (fromRequest) return fromRequest;
  const namePath = context.name.split(" ").find((part) => part.startsWith("/"));
  return namePath ?? "";
}

/** Build a `tracesSampler` with the given default rate. */
export function createTracesSampler(defaultRate: number) {
  return function tracesSampler(context: SamplingInput): number {
    if (isMoneyRoute(samplingPath(context))) return MONEY_TRACES_SAMPLE_RATE;
    return context.inheritOrSampleWith ? context.inheritOrSampleWith(defaultRate) : defaultRate;
  };
}
