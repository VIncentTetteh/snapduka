import type { Json } from "@snapduka/core";

/**
 * Widen a value for a `jsonb` column.
 *
 * `Json` is a recursive union, and TypeScript cannot prove that an arbitrary
 * `Record<string, unknown>` — an audit diff, a webhook body, a snapshot — is
 * made only of JSON-serialisable leaves. Every such payload in this codebase
 * is built from plain data, so the assertion holds; it lives here, named and
 * explained, rather than as an anonymous `as Json` at twenty call sites.
 *
 * Do not reach for this to silence a genuine mismatch. If a value might contain
 * a Date, a Map, a class instance or undefined, serialise it properly first —
 * Postgres will accept the insert and you will find out later, from data that
 * reads back wrong.
 */
export function asJson(value: unknown): Json {
  return value as Json;
}

/**
 * Read a `jsonb` column as an object.
 *
 * A jsonb column can legitimately hold an array, a string or a number, so the
 * generated type is the full `Json` union and property access on it is an
 * error. This narrows once, returning an empty object for anything that is not
 * a plain object, so callers do not each invent their own guard.
 */
export function jsonObject(value: Json | null | undefined): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
