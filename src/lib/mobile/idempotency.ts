import "server-only";

import { createHash } from "node:crypto";

import type { Json } from "@snapduka/core";

import { createAdminClient } from "@/lib/supabase/admin";

import { fail, failUnexpected } from "./response";

/**
 * `Idempotency-Key` support for mutating /api/mobile/v1 routes.
 *
 * The mobile app queues writes made offline and replays them on reconnect. A
 * replay cannot know whether the first attempt reached us — the connection may
 * have died after the order moved but before the response arrived — so every
 * queued write carries a key minted when the seller acted. The first request
 * with a key runs; every later one gets the stored response back verbatim.
 * Without this, a replayed transition either applies twice or, because the
 * version moved, comes back as a version conflict for a change that actually
 * succeeded, and the seller is told to redo work that was done.
 *
 * Stored in the existing `idempotency_keys` table (202606120006: unique
 * (scope, key), 24h `expires_at`, service_role only). Scope is
 * `mobile:<route>:<sellerAccountId>`, so one seller's key can never replay
 * another seller's response, and one route's key cannot answer another route.
 *
 * The header is optional: a request without it runs exactly as before, which
 * keeps every existing client working.
 */

export const IDEMPOTENCY_HEADER = "idempotency-key";

/** UUIDs and similar opaque tokens; long enough to be unguessable, short enough to index. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Matches the table default; restated because a reclaimed key sets it explicitly. */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A claim older than this whose request never finished is treated as dead
 * (the function crashed or timed out) and may be taken over. Longer than any
 * route's own timeout, so a slow request is never run twice concurrently.
 */
export const PENDING_STALE_MS = 60_000;

/**
 * Outcomes that are a property of the request, so replaying them is correct:
 * success, "not found", conflicts and validation. Anything else — 401, 403,
 * 429, 5xx — depends on the moment (a refreshed token, a plan upgrade, a
 * recovered database), so the claim is released and a retry runs afresh.
 */
function isReplayable(status: number): boolean {
  return (status >= 200 && status < 300) || status === 404 || status === 409 || status === 422;
}

type Pending = { state: "pending"; fingerprint: string; startedAt: string };
type Complete = { state: "complete"; fingerprint: string; status: number; body: Json | null };
type Stored = Pending | Complete;

function isStored(value: unknown): value is Stored {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.state === "pending" || v.state === "complete") && typeof v.fingerprint === "string";
}

/**
 * What makes two requests "the same": method, path and exact body. A key sent
 * again with a different body is a client bug, and answering it with the
 * first body's response would silently apply the wrong decision.
 */
function fingerprint(request: Request, body: string): string {
  const { pathname } = new URL(request.url);
  return createHash("sha256").update(`${request.method}\n${pathname}\n${body}`).digest("hex");
}

function replay(stored: Complete): Response {
  const headers = new Headers({ "idempotency-replayed": "true" });
  if (stored.status === 204 || stored.body === null) {
    return new Response(null, { status: stored.status, headers });
  }
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(stored.body), { status: stored.status, headers });
}

type Claim =
  | { kind: "claimed"; id: string }
  | { kind: "replay"; response: Response }
  | { kind: "busy" }
  | { kind: "mismatch" };

async function claim(scope: string, key: string, print: string, attempt = 0): Promise<Claim> {
  const admin = createAdminClient();
  const now = Date.now();
  const pending: Pending = { state: "pending", fingerprint: print, startedAt: new Date(now).toISOString() };

  const { data: inserted, error } = await admin
    .from("idempotency_keys")
    .insert({ scope, key, response: pending, expires_at: new Date(now + TTL_MS).toISOString() })
    .select("id")
    .single();
  if (!error) return { kind: "claimed", id: inserted.id };
  if (error.code !== "23505") throw error;

  const { data: existing, error: readError } = await admin
    .from("idempotency_keys")
    .select("id, response, expires_at")
    .eq("scope", scope)
    .eq("key", key)
    .maybeSingle();
  if (readError) throw readError;
  // Deleted between our insert and read (expired and swept, or released).
  if (!existing) {
    if (attempt > 0) return { kind: "busy" };
    return claim(scope, key, print, attempt + 1);
  }

  const stored = existing.response;
  const expired = new Date(existing.expires_at).getTime() <= now;
  const stale =
    isStored(stored) &&
    stored.state === "pending" &&
    now - new Date(stored.startedAt).getTime() > PENDING_STALE_MS;

  if (expired || stale || !isStored(stored)) {
    if (attempt > 0) return { kind: "busy" };
    // Delete exactly the row we looked at: if another request reclaimed it in
    // the meantime, this matches nothing and our retry sees their claim.
    await admin
      .from("idempotency_keys")
      .delete()
      .eq("id", existing.id)
      .eq("expires_at", existing.expires_at);
    return claim(scope, key, print, attempt + 1);
  }

  if (stored.fingerprint !== print) return { kind: "mismatch" };
  if (stored.state === "pending") return { kind: "busy" };
  return { kind: "replay", response: replay(stored) };
}

async function readBody(response: Response): Promise<Json | null> {
  if (response.status === 204) return null;
  const text = await response.clone().text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return null;
  }
}

export type IdempotencyScope = {
  /** Stable route name, e.g. "orders.transition". Not the URL: ids in the path are part of the fingerprint. */
  route: string;
  sellerAccountId: string;
};

/**
 * Run `handler` at most once per `Idempotency-Key`, replaying its response to
 * any repeat. Call after authentication — the scope needs the seller — and
 * wrap everything that reads the body and writes.
 */
export async function withIdempotency(
  request: Request,
  scope: IdempotencyScope,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get(IDEMPOTENCY_HEADER);
  if (key === null) return handler();
  if (!KEY_PATTERN.test(key)) {
    return fail("validation_failed", "The Idempotency-Key header is not valid.", {
      fields: { [IDEMPOTENCY_HEADER]: "Use 16-128 letters, digits, '-' or '_'." },
    });
  }

  const scopeKey = `mobile:${scope.route}:${scope.sellerAccountId}`;
  // Cloned so the handler can still read the body itself.
  const print = fingerprint(request, await request.clone().text());

  let claimed: Claim;
  try {
    claimed = await claim(scopeKey, key, print);
  } catch (error) {
    // Fail closed: running the write without the guard is exactly the
    // duplicate this exists to prevent. A 500 is retried by the client.
    return failUnexpected("idempotency.claim", error);
  }

  switch (claimed.kind) {
    case "replay":
      return claimed.response;
    case "mismatch":
      return fail(
        "validation_failed",
        "This Idempotency-Key was already used for a different request.",
      );
    case "busy":
      return fail("in_progress", "This change is already being processed. Try again shortly.");
    case "claimed":
      break;
  }

  const admin = createAdminClient();
  const release = async () => {
    const { error } = await admin.from("idempotency_keys").delete().eq("id", claimed.id);
    if (error) console.error("[mobile-api] idempotency.release", error);
  };

  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    await release();
    throw error;
  }

  if (!isReplayable(response.status)) {
    await release();
    return response;
  }

  const complete: Complete = {
    state: "complete",
    fingerprint: print,
    status: response.status,
    body: await readBody(response),
  };
  const { error } = await admin
    .from("idempotency_keys")
    .update({ response: complete })
    .eq("id", claimed.id);
  if (error) {
    // The write happened; only the receipt is missing. A retry within
    // PENDING_STALE_MS gets "in progress", after that it runs again — and the
    // route's own guards (expectedVersion) turn that into a conflict rather
    // than a duplicate. Logged, not surfaced: the seller's change succeeded.
    console.error("[mobile-api] idempotency.store", error);
  }
  return response;
}
