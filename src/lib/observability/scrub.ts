import type { Breadcrumb, Event } from "@sentry/nextjs";

/**
 * PII and secret scrubbing for every event the web app sends to Sentry.
 *
 * Runs in all three runtimes (browser, Node, edge), so this module is pure: no
 * `server-only`, no Node APIs, and only type imports from the SDK.
 *
 * The rules deliberately mirror apps/mobile/lib/monitoring.ts (same header
 * list, same key needles, user reduced to `{ id }`) so a buyer's phone number
 * cannot be redacted on one platform and leak on the other. The web adds two
 * things mobile does not need:
 *
 *   1. Value-level redaction. Server errors quote user input back at us
 *      ("invalid phone +233 24 123 4567"), PostgREST filters put phone numbers
 *      in span URLs (`?phone=eq.+233...`), and Paystack/Meta errors echo keys.
 *      Key-based scrubbing alone never sees any of those.
 *   2. Whole-body drops on /api/payments/** and /api/auth/**. Those bodies are
 *      Paystack webhooks (buyer email, card BIN, authorization codes) and the
 *      Supabase SMS hook (OTP + phone). There is no field in them worth the
 *      risk of keeping, so the body is removed rather than walked.
 *
 * If you add a rule here, add it to the mobile scrubber too.
 */

export const REDACTED = "[redacted]";

/** Header names whose values must never leave the process. Mobile list + server-only headers. */
export const SENSITIVE_HEADERS = [
  "authorization",
  "apikey",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
  "x-paystack-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-supabase-signature",
  "x-internal-job-secret",
];

/**
 * Object keys (substring match, case-insensitive) that carry personal data or
 * credentials. The first block is the mobile list verbatim.
 */
export const SENSITIVE_KEYS = [
  "phone",
  "email",
  "name",
  "buyer_snapshot",
  "buyerSnapshot",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "contact",
  "recipient",
  // Server-side additions: payment and Meta credentials, OTPs, addresses.
  "secret",
  "authorization",
  "cookie",
  "account_number",
  "accountNumber",
  "bvn",
  "address",
  "signature",
];

/**
 * Sentry context blocks that are SDK-generated and structural. Walking them
 * with the key rules would redact `os.name`, `runtime.name`, `browser.name`
 * and break Sentry's grouping UI while protecting nothing.
 */
const STRUCTURAL_CONTEXTS = new Set([
  "trace",
  "os",
  "runtime",
  "browser",
  "device",
  "app",
  "culture",
  "cloud_resource",
  "otel",
  "response",
]);

/** Routes whose request bodies are dropped entirely (see module comment). */
const BODY_DROP_PREFIXES = ["/api/payments/", "/api/auth/"];

/**
 * Path segments that are bearer capabilities: whoever holds the URL can see
 * the order or accept the invite. They are redacted like any other secret.
 */
const CAPABILITY_PATH = /\/(orders|l|d|invitations)\/([^/?#\s]+)/g;

type Rule = { pattern: RegExp; replacement: string };

/**
 * Value-level rules, applied to every string we keep. Order matters: specific
 * secret shapes run before the generic phone rules so a long key is not
 * half-matched as a phone number first.
 */
const VALUE_RULES: Rule[] = [
  // JWTs (Supabase access tokens, signed cookies).
  { pattern: /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, replacement: REDACTED },
  // Bearer/Basic credentials quoted in messages.
  { pattern: /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, replacement: `$1 ${REDACTED}` },
  // Paystack secret/public keys.
  { pattern: /\b[sp]k_(?:live|test)_[A-Za-z0-9]+/g, replacement: REDACTED },
  // Meta (WhatsApp/Instagram/Facebook) access tokens.
  { pattern: /\bEAA[A-Za-z0-9]{20,}/g, replacement: REDACTED },
  // Credentials passed as query/form parameters.
  {
    pattern: /([?&;](?:access_token|refresh_token|token|secret|client_secret|app_secret|apikey|api_key|password|otp)=)[^&#\s]+/gi,
    replacement: `$1${REDACTED}`,
  },
  // Email addresses.
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: REDACTED },
  // Ghana (+233), Nigeria (+234) and Côte d'Ivoire (+225), with or without the
  // plus, with spaces/dots/dashes between groups: 8-10 subscriber digits
  // covers GH (9), NG (10) and both old (8) and 2021+ (10) CI plans.
  { pattern: /(?<![\w+])\+?(?:233|234|225)(?:[\s.-]?\d){8,10}(?![\w])/g, replacement: REDACTED },
  // Any other E.164 number.
  { pattern: /(?<![\w])\+\d(?:[\s.-]?\d){7,14}(?![\w])/g, replacement: REDACTED },
  // National formats with the trunk 0: GH 0XX XXX XXXX (10 digits),
  // NG 0XXX XXX XXXX (11), CI 07 08 09 10 11 (10). The `-` guard keeps UUID
  // segments and order references out of it.
  { pattern: /(?<![\w-])0\d(?:[\s.-]?\d){8,9}(?![\w-])/g, replacement: REDACTED },
];

/** Redact emails, phone numbers and credential shapes inside free text. */
export function scrubString(value: string): string {
  let out = value;
  for (const { pattern, replacement } of VALUE_RULES) out = out.replace(pattern, replacement);
  return out;
}

/** Redact capability tokens in a URL or path, then apply the value rules. */
export function scrubUrl(value: string): string {
  return scrubString(value.replace(CAPABILITY_PATH, (_match, prefix: string) => `/${prefix}/[token]`));
}

/**
 * Keys too short to substring-match safely ("pin" is inside "shipping", "otp"
 * inside "footprint"), so they only match whole.
 */
export const SENSITIVE_EXACT_KEYS = ["otp", "pin", "cvv", "ip", "ip_address"];

/**
 * Span attributes use dotted OpenTelemetry names (`db.name`,
 * `server.address`) that the broad PII needles would redact for no gain; only
 * credential-shaped attribute keys are dropped there. Values are still
 * value-scrubbed.
 */
const SPAN_SENSITIVE_KEYS = ["authorization", "cookie", "token", "secret", "password", "apikey", "api_key"];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.includes(lower)) return true;
  return SENSITIVE_KEYS.some((needle) => lower.includes(needle.toLowerCase()));
}

const MAX_DEPTH = 6;

/**
 * Recursively redact sensitive keys and sensitive values. Same shape as the
 * mobile `scrub()` (depth-limited, arrays walked, keys matched by substring)
 * plus value-level redaction of every string.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(inner, depth + 1);
  }
  return out;
}

function scrubRecord(value: Record<string, unknown>): Record<string, unknown> {
  return scrubValue(value) as Record<string, unknown>;
}

function pathOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

/** Whether a request to this URL/path must have its body dropped outright. */
export function isBodyDropRoute(url: string | undefined): boolean {
  const path = pathOf(url);
  return BODY_DROP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADERS.includes(name.toLowerCase()) ? REDACTED : scrubString(value);
  }
  return out;
}

function scrubQuery(query: NonNullable<Event["request"]>["query_string"]): typeof query {
  if (typeof query === "string") return scrubUrl(`?${query}`).slice(1);
  if (Array.isArray(query)) {
    return query.map(([key, value]) => [key, isSensitiveKey(key) ? REDACTED : scrubString(value)]);
  }
  if (query && typeof query === "object") {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubString(value);
    }
    return out;
  }
  return query;
}

function scrubRequest(request: NonNullable<Event["request"]>): NonNullable<Event["request"]> {
  const next = { ...request };
  const dropBody = isBodyDropRoute(next.url);
  if (next.url) next.url = scrubUrl(next.url);
  if (next.headers) next.headers = scrubHeaders(next.headers);
  // Cookies are session material in their entirety; there is nothing to keep.
  if (next.cookies) next.cookies = { redacted: REDACTED };
  if (next.query_string !== undefined) next.query_string = scrubQuery(next.query_string);
  if (dropBody) {
    if (next.data !== undefined) next.data = REDACTED;
  } else if (next.data !== undefined) {
    next.data = scrubValue(next.data);
  }
  return next;
}

function scrubContexts(contexts: NonNullable<Event["contexts"]>): NonNullable<Event["contexts"]> {
  const out: NonNullable<Event["contexts"]> = {};
  for (const [name, context] of Object.entries(contexts)) {
    if (!context) continue;
    out[name] = STRUCTURAL_CONTEXTS.has(name) ? context : scrubRecord(context);
  }
  return out;
}

function scrubSpans(spans: NonNullable<Event["spans"]>): NonNullable<Event["spans"]> {
  return spans.map((span) => ({
    ...span,
    description: span.description === undefined ? undefined : scrubUrl(span.description),
    data: scrubSpanData(span.data),
  }));
}

/**
 * Span data carries `http.url`, `url.full` and `db.statement` style strings,
 * which is where PostgREST phone filters end up. Attribute keys like
 * `http.request.header.authorization` are caught by the key rules.
 */
function scrubSpanData<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (SPAN_SENSITIVE_KEYS.some((needle) => lower.includes(needle))) out[key] = REDACTED;
    else out[key] = typeof value === "string" ? scrubUrl(value) : value;
  }
  return out as T;
}

function scrubExceptions(exception: NonNullable<Event["exception"]>): NonNullable<Event["exception"]> {
  if (!exception.values) return exception;
  return {
    ...exception,
    values: exception.values.map((value) => ({
      ...value,
      value: value.value === undefined ? undefined : scrubString(value.value),
    })),
  };
}

/**
 * Scrub a Sentry event (error or transaction). Used as both `beforeSend` and
 * `beforeSendTransaction`. Never drops the event: losing the error to protect
 * the payload is the wrong trade when the payload can be redacted instead.
 */
export function scrubEvent<T extends Event>(event: T): T {
  const next: T = { ...event };
  if (next.request) next.request = scrubRequest(next.request);
  if (next.message) next.message = scrubString(next.message);
  if (next.exception) next.exception = scrubExceptions(next.exception);
  if (next.extra) next.extra = scrubRecord(next.extra);
  if (next.contexts) next.contexts = scrubContexts(next.contexts);
  // Tags are SDK/route metadata keyed by names like `runtime.name`; only their
  // values are scrubbed.
  if (next.tags) {
    const tags: NonNullable<Event["tags"]> = {};
    for (const [key, value] of Object.entries(next.tags)) {
      tags[key] = typeof value === "string" ? scrubString(value) : value;
    }
    next.tags = tags;
  }
  if (next.spans) next.spans = scrubSpans(next.spans);
  if (next.breadcrumbs) next.breadcrumbs = next.breadcrumbs.map(scrubBreadcrumb);
  // The id is enough to find the account; email, IP and username are not needed.
  if (next.user) next.user = next.user.id === undefined ? {} : { id: next.user.id };
  return next;
}

/** Scrub a breadcrumb (`beforeBreadcrumb`). Fetch/XHR breadcrumbs carry URLs. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const next = { ...breadcrumb };
  if (next.message) next.message = scrubString(next.message);
  if (next.data) {
    const data = scrubRecord(next.data);
    if (typeof data.url === "string") data.url = scrubUrl(data.url);
    if (typeof data.from === "string") data.from = scrubUrl(data.from);
    if (typeof data.to === "string") data.to = scrubUrl(data.to);
    next.data = data;
  }
  return next;
}
