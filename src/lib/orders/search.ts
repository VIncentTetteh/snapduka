/**
 * Order list search and filtering (ORD-003).
 *
 * The dashboard could only match `public_reference`, so typing a customer's
 * name or a product returned "No orders yet" — indistinguishable from having no
 * orders at all. A seller looking for "that dress Ama ordered" has neither piece
 * of information the old search accepted.
 */

/** Columns on `orders` a free-text search matches. All are buyer-supplied. */
export const ORDER_SEARCH_COLUMNS = [
  "public_reference",
  "buyer_snapshot->>name",
  "buyer_snapshot->>phone",
  "buyer_snapshot->>email",
] as const;

/**
 * Rolling windows rather than calendar days. There is no timezone handling
 * anywhere in this codebase and the server runs UTC, so a "Today" filter would
 * start at 01:00 for a Nigerian seller (UTC+1) and quietly hide every order
 * placed in the first hour of their day. A rolling window has no midnight
 * boundary, so it is correct in all three markets.
 */
export const ORDER_RANGES = {
  "24h": { label: "24 hours", hours: 24 },
  "7d": { label: "7 days", hours: 24 * 7 },
  "30d": { label: "30 days", hours: 24 * 30 },
} as const;

export type OrderRange = keyof typeof ORDER_RANGES;

export function isOrderRange(value: string | undefined): value is OrderRange {
  return value !== undefined && Object.hasOwn(ORDER_RANGES, value);
}

/**
 * The ISO cutoff for a range, or null for "any time".
 *
 * `now` is injected rather than read from the clock so the behaviour is
 * testable — the same reason the notification schedulers take one.
 */
export function rangeCutoff(range: string | undefined, now: Date): string | null {
  if (!isOrderRange(range)) return null;
  return new Date(now.getTime() - ORDER_RANGES[range].hours * 3_600_000).toISOString();
}

/**
 * Escape a search term for the PostgREST filter grammar.
 *
 * `.or()` takes a raw string in which `,` separates clauses and `.` separates
 * column/operator/value, so an unescaped term containing either is parsed as
 * structure instead of text. Double-quoting is the documented escape; `\` and
 * `"` then need backslashes of their own.
 *
 * `%` and `*` are dropped rather than escaped: both are ilike wildcards to
 * PostgREST, it offers no escape for them, and nobody searches an order list
 * for a literal percent sign. Leaving them in would let one stray character
 * turn a search into "match everything".
 */
export function escapeSearchTerm(term: string): string {
  const literal = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"%${literal}%"`;
}

/**
 * The single place a raw `?q=` becomes a term the rest of the page uses.
 *
 * Wildcards are removed rather than escaped: both `%` and `*` are ilike
 * wildcards to PostgREST, which offers no way to escape them. Stripping first
 * means a term that was nothing but wildcards normalises to empty and is
 * treated as no search at all — otherwise searching `%` becomes `ilike '%%'`,
 * quietly returning every order while the box still shows a search term.
 */
export function normalizeSearchTerm(raw: string | undefined): string {
  return (raw ?? "").replace(/[%*]/g, "").trim();
}

/**
 * The same term as a plain ilike pattern, for a standalone `.ilike()` filter
 * where supabase-js encodes the value itself.
 */
export function ilikePattern(term: string): string {
  return `%${term}%`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the PostgREST `.or()` clause for a search term.
 *
 * `orderIds` are orders whose line items matched the term — product names live
 * on `order_lines`, and PostgREST cannot OR across an embedded resource and its
 * parent, so they are resolved in a separate query and folded in here by id.
 *
 * Returns null for an empty term so the caller can skip `.or()` entirely rather
 * than apply a filter that matches everything.
 */
export function buildOrderSearchFilter(term: string, orderIds: readonly string[] = []): string | null {
  if (!term) return null;

  const value = escapeSearchTerm(term);
  const clauses: string[] = ORDER_SEARCH_COLUMNS.map((column) => `${column}.ilike.${value}`);

  // Defensive: these come from our own query, but they are interpolated into a
  // filter string, so anything that is not a UUID has no business being there.
  const ids = orderIds.filter((id) => UUID.test(id));
  if (ids.length) clauses.push(`id.in.(${ids.join(",")})`);

  return clauses.join(",");
}
