import type { ZodType } from "zod";

import { resolveServerActor, type SellerActor } from "@/lib/auth/actor";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { checkRateLimit, type RateLimitConfig } from "@/lib/rate-limit";

import { fail } from "./response";

/**
 * The four checks every mobile route makes, in the order they have to happen:
 * authenticate, authorize, rate-limit, then validate the body.
 *
 * Each returns either a value or a Response, so a handler reads as a series of
 * early returns rather than nested conditionals — and cannot accidentally skip
 * one, because the value it needs next only exists on the success path.
 */

/**
 * Resolve the caller as an active seller holding `permission`.
 *
 * `actor.role` is undefined for the account owner (they have no team_memberships
 * row), which is why every call site in this codebase reads `actor.role ??
 * "owner"`. Getting that wrong locks owners out of their own shop.
 */
export async function requireSeller(
  permission: Permission,
): Promise<SellerActor | Response> {
  const actor = await resolveServerActor();

  if (!actor.authenticated) {
    return fail("unauthenticated", "Sign in to continue.");
  }
  if (actor.kind !== "seller") {
    return fail("forbidden", "This account is not a seller account.");
  }
  if (!["pending", "active"].includes(actor.status)) {
    return fail(
      "forbidden",
      actor.status === "suspended"
        ? "This account is suspended. Contact support."
        : "This account is closed.",
    );
  }
  if (!hasPermission(actor.role ?? "owner", permission)) {
    return fail("forbidden", "Your role does not allow this.");
  }
  return actor;
}

/** Resolve an authenticated user who is *not* yet a seller (onboarding only). */
export async function requireAuthenticated(): Promise<
  { userId: string; email: string | null } | Response
> {
  const actor = await resolveServerActor();
  if (!actor.authenticated || !("userId" in actor)) {
    return fail("unauthenticated", "Sign in to continue.");
  }
  return { userId: actor.userId, email: actor.email };
}

/**
 * Postgres-backed sliding window, shared across serverless instances — the same
 * limiter the OTP and checkout paths use.
 */
export async function enforceRateLimit(
  route: string,
  subject: string,
  config: RateLimitConfig,
): Promise<Response | null> {
  const result = await checkRateLimit(`mobile:${route}:${subject}`, config);
  if (result.ok) return null;
  return fail("rate_limited", "Too many requests. Try again shortly.", {
    retryAfterMs: result.retryAfterMs,
  });
}

/**
 * Parse and validate a JSON body, mapping Zod issues onto the `fields` map the
 * client renders next to each input.
 */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | Response> {
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fail("validation_failed", "Check the highlighted fields.", { fields });
}

/** True when a guard returned a Response rather than a value. */
export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
