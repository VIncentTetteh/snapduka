import { NextResponse } from "next/server";

/**
 * One response shape for every /api/mobile/v1 route.
 *
 * The mobile client branches on `error.code`, never on the message: a 409 from
 * a stale order version has to trigger a refetch-and-retry prompt, while a 403
 * from a plan limit has to show an upgrade path. Free-text errors — which is
 * what the existing web API routes return — cannot carry that distinction, and
 * a client that parses English strings breaks the first time one is reworded.
 */

export type MobileErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "plan_limit"
  | "not_found"
  | "conflict"
  | "version_conflict"
  | "validation_failed"
  | "rate_limited"
  | "internal";

const STATUS: Record<MobileErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  plan_limit: 403,
  not_found: 404,
  conflict: 409,
  version_conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal: 500,
};

export type MobileErrorBody = {
  error: {
    code: MobileErrorCode;
    message: string;
    /** Field-level messages, keyed by the input name the client sent. */
    fields?: Record<string, string>;
  };
  requestId: string;
};

function requestId(): string {
  return crypto.randomUUID();
}

/** A successful response. `data` is always an object, never a bare array. */
export function ok<T extends object>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(
  code: MobileErrorCode,
  message: string,
  options: { fields?: Record<string, string>; retryAfterMs?: number } = {},
): NextResponse {
  const body: MobileErrorBody = {
    error: { code, message, ...(options.fields ? { fields: options.fields } : {}) },
    requestId: requestId(),
  };
  const response = NextResponse.json(body, { status: STATUS[code] });
  if (code === "rate_limited" && options.retryAfterMs !== undefined) {
    response.headers.set("Retry-After", String(Math.ceil(options.retryAfterMs / 1000)));
  }
  return response;
}

/** Narrow a `unknown` thrown value into a 500 without leaking internals. */
export function failUnexpected(context: string, error: unknown): NextResponse {
  console.error(`[mobile-api] ${context}`, error);
  return fail("internal", "Something went wrong. Please try again.");
}
